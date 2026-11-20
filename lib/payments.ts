// THANH TOÁN TỰ ĐỘNG: tiền chuyển khoản về (SePay báo qua webhook) → ghi nhận → xác nhận đơn.
// Route nhận webhook (app/api/webhooks/sepay/route.ts) đã kiểm tra chữ ký; file này lo NGHIỆP VỤ.
//
// Nguyên tắc: tiền ĐÃ vào tài khoản là sự thật — luôn GHI NHẬN, không bao giờ "từ chối".
// Việc còn lại chỉ là quyết định: xác nhận đơn, chờ khách chuyển bù, hay đánh dấu cần HOÀN TIỀN.
//
//   Đơn PENDING   + đủ tiền            → CONFIRMED (thừa thì phần thừa chờ hoàn)
//   Đơn PENDING   + thiếu tiền         → giữ PENDING, chờ chuyển bù (PARTIAL)
//   Đơn EXPIRED   + đủ tiền + còn chỗ  → giữ lại chỗ, CONFIRMED (tiền về trễ)
//   Đơn EXPIRED   + hết chỗ / thiếu    → chờ hoàn tiền
//   Đơn CONFIRMED / CANCELLED          → chờ hoàn tiền (chuyển 2 lần / đơn đã huỷ)
import { Prisma } from "@/generated/prisma/client";
import { SYSTEM, writeAuditLog } from "@/lib/audit";
import { reserveSeats } from "@/lib/booking";
import { recordTransition } from "@/lib/booking-history";
import { summarizePayments } from "@/lib/payment-summary";
import { prisma } from "@/lib/prisma";
import { extractBookingCode, type SepayTransfer } from "@/lib/sepay";

export const SEPAY = "sepay";

export type PaymentOutcome =
  | "CONFIRMED" // đơn được xác nhận nhờ khoản này
  | "PARTIAL" // đã ghi nhận nhưng chưa đủ tiền
  | "REFUND_PENDING" // đã ghi nhận, toàn bộ khoản này chờ hoàn
  | "UNMATCHED" // không tìm thấy đơn tương ứng → nhân viên tự đối soát
  | "IGNORED" // tiền RA khỏi tài khoản, không liên quan
  | "DUPLICATE"; // webhook này đã xử lý rồi (SePay gửi lại)

export type ProcessResult = { outcome: PaymentOutcome; bookingCode?: string };

export async function processSepayTransfer(transfer: SepayTransfer): Promise<ProcessResult> {
  try {
    // MỘT transaction cho tất cả: ghi sự kiện + ghi tiền + đổi trạng thái đơn.
    // Nếu giữa chừng lỗi → rollback CẢ sự kiện → SePay gửi lại → xử lý lại từ đầu. Không mất tiền, không xử lý dở.
    return await prisma.$transaction(async (tx) => {
      // IDEMPOTENCY: (provider, provider_event_id) là UNIQUE. Webhook gửi lại → INSERT này lỗi P2002 → bắt ở dưới.
      // Hai bản gửi lại tới CÙNG LÚC: bản sau phải đợi bản trước commit (index UNIQUE), rồi mới lỗi P2002.
      const event = await tx.webhookEvent.create({
        data: {
          provider: SEPAY,
          providerEventId: String(transfer.id),
          payload: transfer,
          signatureValid: true, // chỉ webhook ĐÃ qua kiểm tra chữ ký mới được lưu (xem route.ts)
        },
        select: { id: true },
      });

      const result = await applyTransfer(tx, transfer);

      await tx.webhookEvent.update({
        where: { id: event.id },
        data: { outcome: result.outcome, processedAt: new Date() },
      });
      return result;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { outcome: "DUPLICATE" };
    throw e;
  }
}

async function applyTransfer(tx: Prisma.TransactionClient, t: SepayTransfer): Promise<ProcessResult> {
  if (t.transferType !== "in") return { outcome: "IGNORED" };

  const code = extractBookingCode(t.code) ?? extractBookingCode(t.content);
  if (!code) return { outcome: "UNMATCHED" };

  // KHOÁ DÒNG ĐƠN (FOR UPDATE) trước khi đọc: trong lúc mình xử lý, job hết hạn / nhân viên huỷ /
  // một khoản chuyển khác cho cùng đơn đều phải ĐỢI → mình đọc trạng thái và tổng tiền chắc chắn đúng.
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM bookings WHERE code = ${code} FOR UPDATE`;
  if (locked.length === 0) return { outcome: "UNMATCHED", bookingCode: code };

  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: locked[0].id },
    select: { id: true, code: true, status: true, sessionId: true, quantity: true, totalAmount: true },
  });

  // Ghi nhận tiền TRƯỚC khi quyết định gì khác. provider_txn_id UNIQUE = lớp chống trùng thứ hai.
  const payment = await tx.payment.create({
    data: {
      bookingId: booking.id,
      provider: SEPAY,
      providerTxnId: String(t.id),
      amount: t.transferAmount,
      status: "SUCCEEDED",
      paidAt: new Date(),
    },
    select: { id: true },
  });
  const paid = await keptAmount(tx, booking.id); // tổng tiền đang giữ của đơn, GỒM khoản vừa ghi
  const ctx = { bookingCode: booking.code };

  if (booking.status === "CONFIRMED" || booking.status === "CANCELLED") {
    const reason = booking.status === "CONFIRMED" ? "Đơn đã thanh toán đủ trước đó" : "Đơn đã bị huỷ";
    await markForRefund(tx, payment.id, t.transferAmount, reason);
    return { outcome: "REFUND_PENDING", ...ctx };
  }

  if (paid < booking.totalAmount) {
    if (booking.status === "PENDING") return { outcome: "PARTIAL", ...ctx }; // chờ chuyển bù
    // EXPIRED mà vẫn thiếu tiền → không giữ lại chỗ được → hoàn khoản này
    await markForRefund(tx, payment.id, t.transferAmount, "Đơn đã hết hạn giữ chỗ, số tiền chưa đủ");
    return { outcome: "REFUND_PENDING", ...ctx };
  }

  // ĐỦ TIỀN.
  if (booking.status === "EXPIRED") {
    // Tiền về TRỄ: chỗ đã được trả lại cho buổi. Thử giữ lại bằng ĐÚNG câu UPDATE an toàn lúc khách đặt.
    const reserved = await reserveSeats(tx, booking.sessionId, booking.quantity);
    if (reserved === 0) {
      await markForRefund(tx, payment.id, t.transferAmount, "Tiền về sau khi hết hạn giữ chỗ và buổi không còn chỗ");
      return { outcome: "REFUND_PENDING", ...ctx };
    }
  }

  // Đã khoá dòng đơn nên trạng thái không thể đổi giữa chừng — vẫn đặt điều kiện status cho chắc (compare-and-set).
  // Nếu vẫn 0 dòng (có bug ở đâu đó) → văng lỗi → rollback toàn bộ → SePay gửi lại → xử lý lại từ đầu.
  const { count } = await tx.booking.updateMany({
    where: { id: booking.id, status: booking.status },
    data: { status: "CONFIRMED" },
  });
  if (count === 0) throw new Error(`Đơn ${booking.code} đổi trạng thái giữa chừng, sẽ xử lý lại khi SePay gửi lại`);
  await recordTransition(tx, {
    bookingId: booking.id,
    from: booking.status,
    to: "CONFIRMED",
    actor: SYSTEM,
    action: "booking.paid",
    note: booking.status === "EXPIRED" ? "Thanh toán chuyển khoản (về trễ, đã giữ lại chỗ)" : "Thanh toán chuyển khoản",
    metadata: { paymentId: payment.id, paid, providerTxnId: String(t.id) },
  });

  const excess = paid - booking.totalAmount;
  if (excess > 0) await markForRefund(tx, payment.id, excess, "Khách chuyển thừa");
  return { outcome: "CONFIRMED", ...ctx };
}

// Tiền đơn ĐANG GIỮ = các khoản đã thu, trừ phần đã/đang chờ hoàn (công thức ở lib/payment-summary.ts).
async function keptAmount(tx: Prisma.TransactionClient, bookingId: string): Promise<number> {
  const payments = await tx.payment.findMany({
    where: { bookingId },
    select: { amount: true, status: true, refundAmount: true },
  });
  return summarizePayments(payments).kept;
}

async function markForRefund(tx: Prisma.TransactionClient, paymentId: string, refundAmount: number, reason: string) {
  await tx.payment.update({
    where: { id: paymentId },
    data: { status: "REFUND_PENDING", refundAmount, refundReason: reason },
  });
  await writeAuditLog(tx, {
    actor: SYSTEM,
    action: "payment.refund_pending",
    entityType: "Payment",
    entityId: paymentId,
    metadata: { refundAmount, reason },
  });
}

// Đơn kết thúc mà không được phục vụ (hết hạn / bị huỷ) → TOÀN BỘ tiền đang giữ của đơn chờ hoàn.
// Gọi trong CÙNG transaction với việc đổi trạng thái đơn (lib/booking-admin.ts). Trả về tổng tiền chờ hoàn.
export async function markBookingPaymentsForRefund(
  tx: Prisma.TransactionClient,
  bookingId: string,
  reason: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ id: string; amount: number }[]>`
    UPDATE payments
    SET status = 'REFUND_PENDING', refund_amount = amount, refund_reason = ${reason}, updated_at = now()
    WHERE booking_id = ${bookingId}::uuid AND status IN ('SUCCEEDED', 'REFUND_PENDING')
    RETURNING id, amount
  `;
  return rows.reduce((sum, r) => sum + r.amount, 0);
}
