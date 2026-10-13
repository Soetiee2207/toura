import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { canTransition, getAdminBookingDetail } from "@/lib/booking-admin";
import { formatDateTimeVN, formatVND } from "@/lib/format";
import { STATUS_LABEL, StatusBadge } from "../status-badge";
import { BookingActions } from "./booking-actions";

// /admin/bookings/TRA-XXXXXX — chi tiết đơn cho nhân viên: thông tin đầy đủ, lịch sử, nút xác nhận/huỷ.
export default function AdminBookingDetailPage({ params }: PageProps<"/admin/bookings/[code]">) {
  return (
    <div>
      <Link href="/admin/bookings" className="text-sm text-stone-500 hover:text-stone-900">
        ← Danh sách đơn
      </Link>
      <Suspense fallback={<div className="mt-4 h-96 animate-pulse rounded-xl bg-stone-200" />}>
        <Detail params={params} />
      </Suspense>
    </div>
  );
}

async function Detail({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireUser();
  const { code } = await params;
  const b = await getAdminBookingDetail(decodeURIComponent(code));
  if (!b) notFound();

  // Nút chỉ là GỢI Ý giao diện (dùng chung bảng chuyển trạng thái với server).
  // Quyết định thật vẫn nằm ở confirmBooking/cancelBooking — ẩn nút không phải là bảo mật.
  const canConfirm = canTransition(b.status, "CONFIRMED") && b.expiresAt > new Date();
  const canCancel = canTransition(b.status, "CANCELLED") && (b.status === "PENDING" || user.role === "ADMIN");

  return (
    <div className="mt-4 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-xl font-bold">{b.code}</h1>
          <StatusBadge status={b.status} />
        </div>

        <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
          <dt className="text-stone-500">Trải nghiệm</dt>
          <dd>{b.session.experience.title}</dd>
          <dt className="text-stone-500">Buổi</dt>
          <dd>
            {formatDateTimeVN(b.session.startsAt)}{" "}
            <span className="text-stone-500">
              ({b.session.seatsBooked}/{b.session.capacity} chỗ đã giữ)
            </span>
          </dd>
          <dt className="text-stone-500">Khách</dt>
          <dd>{b.contactName}</dd>
          <dt className="text-stone-500">Email</dt>
          <dd>{b.contactEmail}</dd>
          <dt className="text-stone-500">Điện thoại</dt>
          <dd>
            <a href={`tel:${b.contactPhone}`} className="text-emerald-700 hover:underline">
              {b.contactPhone}
            </a>
          </dd>
          <dt className="text-stone-500">Số người</dt>
          <dd>
            {b.quantity} × {formatVND(b.unitPrice)} = <strong>{formatVND(b.totalAmount)}</strong>
          </dd>
          <dt className="text-stone-500">Đặt lúc</dt>
          <dd>{formatDateTimeVN(b.createdAt)}</dd>
          {b.status === "PENDING" && (
            <>
              <dt className="text-stone-500">Giữ chỗ đến</dt>
              <dd>{formatDateTimeVN(b.expiresAt)}</dd>
            </>
          )}
          {b.cancelledReason && (
            <>
              <dt className="text-stone-500">Lý do huỷ</dt>
              <dd>{b.cancelledReason}</dd>
            </>
          )}
        </dl>

        <BookingActions bookingId={b.id} canConfirm={canConfirm} canCancel={canCancel} />
      </section>

      <section className="h-fit rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="font-semibold">Lịch sử trạng thái</h2>
        <ol className="mt-3 space-y-3 border-l-2 border-stone-200 pl-4 text-sm">
          {b.statusHistory.map((h) => (
            <li key={h.id}>
              <p>
                {h.fromStatus ? `${STATUS_LABEL[h.fromStatus]} → ` : ""}
                <strong>{STATUS_LABEL[h.toStatus]}</strong>
              </p>
              <p className="text-xs text-stone-500">
                {formatDateTimeVN(h.createdAt)} · {h.actorUser?.name ?? (h.actorType === "CUSTOMER" ? "Khách" : "Hệ thống")}
              </p>
              {h.note && <p className="mt-0.5 text-stone-600">“{h.note}”</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
