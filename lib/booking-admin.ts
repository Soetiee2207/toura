// Quản lý đơn từ phía nhân viên: danh sách, xem chi tiết, XÁC NHẬN, HUỶ.
// File này KHÔNG tự kiểm tra đăng nhập — Server Action gọi requireUser() rồi truyền "actor" (ai đang làm) vào đây.
// Nhưng QUY TẮC NGHIỆP VỤ (trạng thái nào được sang trạng thái nào, vai trò nào được làm gì) nằm ở đây → test được.
import { Prisma } from "@/generated/prisma/client";
import type { BookingStatus } from "@/generated/prisma/enums";
import { type Actor, SYSTEM, staffRef } from "@/lib/audit";
import { recordTransition } from "@/lib/booking-history";
import { markBookingPaymentsForRefund } from "@/lib/payments";
import { prisma } from "@/lib/prisma";

export type { Actor };

// ── MÁY TRẠNG THÁI ─────────────────────────────────────────
// Trạng thái hiện tại → các trạng thái ĐƯỢC PHÉP chuyển sang. Không có trong bảng = cấm.
// CANCELLED là "điểm cuối": đơn đã huỷ không thể sống lại (muốn đi thì đặt đơn mới).
// EXPIRED → CONFIRMED chỉ có MỘT đường: tiền chuyển khoản về trễ mà buổi vẫn còn chỗ (lib/payments.ts).
// Nhân viên không xác nhận tay được đơn đã hết hạn (confirmBooking chặn bằng HOLD_EXPIRED).
const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["CANCELLED"],
  CANCELLED: [],
  EXPIRED: ["CONFIRMED"],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type AdminBookingErrorCode = "NOT_FOUND" | "INVALID_TRANSITION" | "HOLD_EXPIRED" | "FORBIDDEN" | "CONFLICT";

export class AdminBookingError extends Error {
  constructor(
    public readonly code: AdminBookingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdminBookingError";
  }
}

// ── XÁC NHẬN ĐƠN (PENDING → CONFIRMED) ─────────────────────
// Giai đoạn 1: khách chuyển khoản/đặt cọc ngoài hệ thống → nhân viên kiểm tra rồi bấm xác nhận.
export async function confirmBooking(bookingId: string, actor: Actor): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const booking = await findForUpdate(tx, bookingId);
    assertTransition(booking.status, "CONFIRMED");
    if (booking.expiresAt <= new Date()) {
      throw new AdminBookingError("HOLD_EXPIRED", "Đơn đã quá hạn giữ chỗ, không thể xác nhận.");
    }

    // Thêm điều kiện "còn hạn" vào chính câu UPDATE: nếu đúng lúc này job vừa cho hết hạn thì không xác nhận nhầm
    await compareAndSet(tx, bookingId, booking.status, { status: "CONFIRMED" }, { expiresAt: { gt: new Date() } });
    await recordTransition(tx, {
      bookingId,
      from: booking.status,
      to: "CONFIRMED",
      actor: staffRef(actor),
      action: "booking.confirm",
    });
  });
}

// ── HUỶ ĐƠN (PENDING/CONFIRMED → CANCELLED) + TRẢ CHỖ ──────
export async function cancelBooking(bookingId: string, actor: Actor, reason: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const booking = await findForUpdate(tx, bookingId);
    assertTransition(booking.status, "CANCELLED");
    // Đơn đã xác nhận = khách đã trả tiền → huỷ kéo theo hoàn tiền → chỉ ADMIN được làm.
    if (booking.status === "CONFIRMED" && actor.role !== "ADMIN") {
      throw new AdminBookingError("FORBIDDEN", "Chỉ quản trị viên được huỷ đơn đã xác nhận.");
    }

    await compareAndSet(tx, bookingId, booking.status, {
      status: "CANCELLED",
      cancelledBy: actor.role,
      cancelledAt: new Date(),
      cancelledReason: reason,
    });

    // TRẢ CHỖ cho buổi. Chạy SAU compareAndSet → chỉ request "thắng" mới tới được đây → chỗ chỉ được trả MỘT lần.
    await tx.session.update({
      where: { id: booking.sessionId },
      data: { seatsBooked: { decrement: booking.quantity } },
    });
    // Khách đã chuyển tiền (đủ hoặc một phần) → toàn bộ chờ hoàn
    const refundPending = await markBookingPaymentsForRefund(tx, bookingId, `Đơn bị huỷ: ${reason}`);

    await recordTransition(tx, {
      bookingId,
      from: booking.status,
      to: "CANCELLED",
      actor: staffRef(actor),
      action: "booking.cancel",
      note: reason,
      metadata: { reason, seatsReleased: booking.quantity, refundPending },
    });
  });
}

// ── HẾT HẠN GIỮ CHỖ (PENDING → EXPIRED) + TRẢ CHỖ — do job tự động gọi ──
// Khách giữ chỗ nhưng không được xác nhận kịp → trả chỗ để người khác đặt.
// An toàn khi chạy lặp lại, hoặc 2 job chạy chồng nhau: compare-and-set đảm bảo mỗi đơn chỉ hết hạn MỘT lần.
export async function expireOverdueBookings({ now = new Date(), limit = 500 } = {}) {
  // Bước 1: tìm ứng viên (chỉ ĐỌC — chưa thay đổi gì, nên kết quả có thể đã cũ khi xử lý tới)
  const candidates = await prisma.booking.findMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
    take: limit,
    select: { id: true },
  });

  // Bước 2: xử lý TỪNG đơn trong transaction riêng → một đơn lỗi không kéo cả mẻ rollback
  let expired = 0;
  for (const { id } of candidates) {
    if (await expireOne(id, now)) expired++;
  }
  return { scanned: candidates.length, expired };
}

async function expireOne(bookingId: string, now: Date): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      const booking = await findForUpdate(tx, bookingId);
      // Kiểm tra lại cả "còn hạn không": giữa bước 1 và bây giờ, nhân viên có thể đã xác nhận/huỷ đơn
      await compareAndSet(tx, bookingId, "PENDING", { status: "EXPIRED" }, { expiresAt: { lte: now } });
      await tx.session.update({
        where: { id: booking.sessionId },
        data: { seatsBooked: { decrement: booking.quantity } },
      });
      // Khách mới chuyển MỘT PHẦN rồi hết hạn → phần đã chuyển chờ hoàn
      const refundPending = await markBookingPaymentsForRefund(tx, bookingId, "Hết hạn giữ chỗ khi chưa thanh toán đủ");
      await recordTransition(tx, {
        bookingId,
        from: "PENDING",
        to: "EXPIRED",
        actor: SYSTEM,
        action: "booking.expire",
        note: "Hết hạn giữ chỗ",
        metadata: { seatsReleased: booking.quantity, refundPending },
      });
    });
    return true;
  } catch (e) {
    // Người khác đã đổi trạng thái trước (xác nhận/huỷ/job khác) → không phải lỗi, bỏ qua đơn này
    if (e instanceof AdminBookingError && (e.code === "CONFLICT" || e.code === "NOT_FOUND")) return false;
    throw e;
  }
}

// ── Các bước dùng chung ───────────────────────────────────

async function findForUpdate(tx: Prisma.TransactionClient, bookingId: string) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: { status: true, expiresAt: true, sessionId: true, quantity: true },
  });
  if (!booking) throw new AdminBookingError("NOT_FOUND", "Không tìm thấy đơn.");
  return booking;
}

function assertTransition(from: BookingStatus, to: BookingStatus) {
  if (!canTransition(from, to)) {
    throw new AdminBookingError("INVALID_TRANSITION", `Không thể chuyển đơn từ ${from} sang ${to}.`);
  }
}

// COMPARE-AND-SET: chỉ ghi nếu trạng thái VẪN LÀ trạng thái mình vừa đọc.
// Hai nhân viên cùng bấm "Huỷ" một lúc: cả hai đọc thấy PENDING, nhưng Postgres khoá dòng →
// người sau phải chờ, rồi thấy status đã là CANCELLED → WHERE không khớp → count = 0 → báo xung đột.
// (Cùng ý tưởng với "UPDATE ... WHERE seats_booked + n <= capacity" trong lib/booking.ts.)
async function compareAndSet(
  tx: Prisma.TransactionClient,
  bookingId: string,
  expected: BookingStatus,
  data: Prisma.BookingUpdateManyMutationInput,
  extraWhere: Prisma.BookingWhereInput = {},
) {
  const { count } = await tx.booking.updateMany({ where: { ...extraWhere, id: bookingId, status: expected }, data });
  if (count === 0) {
    throw new AdminBookingError("CONFLICT", "Đơn vừa được người khác cập nhật. Vui lòng tải lại trang.");
  }
}

// ── ĐỌC DỮ LIỆU CHO TRANG QUẢN TRỊ ─────────────────────────
// Khác trang của khách (lib/booking.ts → getBookingByCode): nhân viên cần thấy email/SĐT ĐẦY ĐỦ để liên hệ.

export const BOOKINGS_PAGE_SIZE = 20;

export type BookingFilters = { status?: BookingStatus; q?: string; page: number };

export async function listBookings({ status, q, page }: BookingFilters) {
  const where: Prisma.BookingWhereInput = {
    ...(status && { status }),
    ...(q && {
      OR: [
        { code: { contains: q, mode: "insensitive" } },
        { contactName: { contains: q, mode: "insensitive" } },
        { contactEmail: { contains: q, mode: "insensitive" } },
        { contactPhone: { contains: q } },
      ],
    }),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * BOOKINGS_PAGE_SIZE,
      take: BOOKINGS_PAGE_SIZE,
      select: {
        code: true,
        status: true,
        contactName: true,
        contactPhone: true,
        quantity: true,
        totalAmount: true,
        createdAt: true,
        session: { select: { startsAt: true, experience: { select: { title: true } } } },
      },
    }),
  ]);

  return { total, rows, pageCount: Math.max(1, Math.ceil(total / BOOKINGS_PAGE_SIZE)) };
}

export async function getAdminBookingDetail(code: string) {
  return prisma.booking.findUnique({
    where: { code: code.toUpperCase() },
    select: {
      id: true,
      code: true,
      status: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      quantity: true,
      unitPrice: true,
      totalAmount: true,
      expiresAt: true,
      createdAt: true,
      cancelledReason: true,
      session: {
        select: { startsAt: true, capacity: true, seatsBooked: true, experience: { select: { title: true } } },
      },
      statusHistory: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          actorType: true,
          note: true,
          createdAt: true,
          actorUser: { select: { name: true } },
        },
      },
    },
  });
}
