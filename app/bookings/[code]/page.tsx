import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { BookingStatus } from "@/generated/prisma/enums";
import { getBookingByCode } from "@/lib/booking";
import { formatDateTimeVN, formatVND } from "@/lib/format";

// Trang xem đơn: /bookings/TRA-XXXXXX — khách được chuyển tới đây ngay sau khi đặt.
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
    note: "Chỗ của bạn đang được giữ. Chúng tôi sẽ liên hệ qua số điện thoại để xác nhận đơn.",
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
    note: "Đơn chưa được xác nhận kịp thời hạn nên chỗ đã được trả lại.",
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
        <p className="mt-2 text-sm text-stone-500">
          Giữ chỗ đến: <strong>{formatDateTimeVN(booking.expiresAt)}</strong>
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
