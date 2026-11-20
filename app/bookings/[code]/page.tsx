import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { BookingStatus } from "@/generated/prisma/enums";
import { getBookingByCode } from "@/lib/booking";
import { formatDateTimeVN, formatVND } from "@/lib/format";
import { bankAccountFromEnv, sepayQrUrl, transferContentFor } from "@/lib/sepay";
import { AutoRefresh, CopyButton, HoldCountdown } from "./payment-live";

// Trang xem đơn: /bookings/TRA-XXXXXX — khách được chuyển tới đây ngay sau khi đặt.
// Đơn PENDING → hiện mã QR chuyển khoản + đồng hồ giữ chỗ, và tự hỏi lại server cho tới khi tiền về.
export default function BookingPage({ params }: PageProps<"/bookings/[code]">) {
  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-stone-200" />}>
        <BookingDetail params={params} />
      </Suspense>
    </div>
  );
}

const STATUS_UI: Record<BookingStatus, { label: string; className: string; note: string }> = {
  PENDING: {
    label: "Đang giữ chỗ",
    className: "bg-amber-100 text-amber-800",
    note: "Chỗ của bạn đang được giữ. Quét mã QR bên dưới để chuyển khoản — đơn sẽ tự xác nhận khi tiền về.",
  },
  CONFIRMED: {
    label: "Đã xác nhận",
    className: "bg-emerald-100 text-emerald-800",
    note: "Đơn đã được xác nhận. Hẹn gặp bạn tại điểm hẹn!",
  },
  CANCELLED: { label: "Đã huỷ", className: "bg-stone-200 text-stone-700", note: "Đơn này đã bị huỷ." },
  EXPIRED: {
    label: "Hết hạn giữ chỗ",
    className: "bg-stone-200 text-stone-700",
    note: "Đơn chưa được thanh toán kịp thời hạn nên chỗ đã được trả lại.",
  },
};

async function BookingDetail({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const booking = await getBookingByCode(decodeURIComponent(code));
  if (!booking) notFound();

  const ui = STATUS_UI[booking.status];
  const { session } = booking;

  return (
    <article className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-stone-500">Mã đơn</p>
          <p className="font-mono text-2xl font-bold tracking-wider">{booking.code}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${ui.className}`}>{ui.label}</span>
      </div>

      <p className="mt-4 rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{ui.note}</p>
      {booking.status === "PENDING" && (
        <PaymentBox
          code={booking.code}
          amountDue={booking.amountDue}
          paidAmount={booking.paidAmount}
          expiresAt={booking.expiresAt}
        />
      )}
      {booking.refundPending > 0 && (
        <p className="mt-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-800">
          Khoản <strong>{formatVND(booking.refundPending)}</strong> bạn đã chuyển đang chờ hoàn lại. Chúng tôi sẽ liên hệ
          qua số điện thoại để hoàn tiền.
        </p>
      )}

      <dl className="mt-6 divide-y divide-stone-100 text-sm">
        <Row label="Trải nghiệm" value={session.experience.title} />
        <Row label="Thời gian" value={formatDateTimeVN(session.startsAt)} />
        <Row label="Điểm hẹn" value={session.experience.meetingPoint} />
        <Row label="Số người" value={`${booking.quantity} × ${formatVND(booking.unitPrice)}`} />
        <Row label="Tổng tiền" value={<span className="font-bold text-emerald-700">{formatVND(booking.totalAmount)}</span>} />
        <Row label="Người đặt" value={booking.contactName} />
        <Row label="Liên hệ" value={`${booking.maskedPhone} · ${booking.maskedEmail}`} />
      </dl>

      <p className="mt-6 text-xs text-stone-500">Hãy lưu lại mã đơn để tra cứu sau này.</p>
      <Link href="/" className="mt-4 inline-block text-sm font-medium text-emerald-700 hover:underline">
        ← Về trang chủ
      </Link>
    </article>
  );
}

function PaymentBox({
  code,
  amountDue,
  paidAmount,
  expiresAt,
}: {
  code: string;
  amountDue: number;
  paidAmount: number;
  expiresAt: Date;
}) {
  const account = bankAccountFromEnv();
  if (!account) {
    console.error("[payment] Thiếu SEPAY_BANK_ACCOUNT / SEPAY_BANK_CODE / SEPAY_ACCOUNT_NAME trong .env");
    return (
      <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
        Thanh toán trực tuyến tạm thời chưa sẵn sàng. Bạn vui lòng liên hệ chúng tôi để được hỗ trợ.
      </p>
    );
  }
  const content = transferContentFor(code);

  return (
    <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4" aria-label="Thanh toán chuyển khoản">
      <AutoRefresh />
      <HoldCountdown expiresAt={expiresAt.toISOString()} />
      {paidAmount > 0 && (
        <p className="mt-2 text-sm text-amber-800">
          Đã nhận {formatVND(paidAmount)}, bạn cần chuyển thêm <strong>{formatVND(amountDue)}</strong>.
        </p>
      )}

      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {/* Ảnh QR từ máy chủ SePay — dùng <img> thường: ảnh nhỏ, đã tối ưu sẵn, không cần next/image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={sepayQrUrl(account, amountDue, content)}
          alt={`Mã QR chuyển ${formatVND(amountDue)} cho đơn ${code}`}
          width={200}
          height={200}
          className="h-48 w-48 rounded-lg border border-stone-200 bg-white"
        />
        <dl className="w-full flex-1 divide-y divide-amber-100 text-sm">
          <Row label="Ngân hàng" value={account.bank} />
          <Row label="Số tài khoản" value={<Copyable text={account.accountNumber} />} />
          <Row label="Chủ tài khoản" value={account.accountName} />
          <Row label="Số tiền" value={<span className="text-emerald-700">{formatVND(amountDue)}</span>} />
          <Row label="Nội dung" value={<Copyable text={content} />} />
        </dl>
      </div>
      <p className="mt-3 text-xs text-stone-600">
        Quét mã bằng app ngân hàng để tự điền đúng thông tin. Nếu chuyển tay, hãy ghi <strong>đúng nội dung {content}</strong>{" "}
        để hệ thống nhận ra đơn của bạn. Trang này tự cập nhật khi tiền về.
      </p>
    </section>
  );
}

function Copyable({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono">{text}</span>
      <CopyButton text={text} />
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
