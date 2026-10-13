import Link from "next/link";
import { Suspense } from "react";
import type { BookingStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/lib/auth";
import { listBookings } from "@/lib/booking-admin";
import { formatDateTimeVN, formatVND } from "@/lib/format";
import { STATUS_LABEL, StatusBadge } from "./status-badge";

// /admin/bookings?status=PENDING&q=0901&page=2 — bộ lọc nằm trên URL → F5, gửi link cho đồng nghiệp vẫn giữ nguyên.
export default function AdminBookingsPage({ searchParams }: PageProps<"/admin/bookings">) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Đơn đặt chỗ</h1>
      <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-xl bg-stone-200" />}>
        <BookingList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const STATUSES = Object.keys(STATUS_LABEL) as BookingStatus[];

async function BookingList({ searchParams }: { searchParams: PageProps<"/admin/bookings">["searchParams"] }) {
  await requireUser();
  const params = await searchParams;

  // searchParams do người dùng gõ được → chỉ nhận giá trị hợp lệ, còn lại bỏ qua
  const status = STATUSES.find((s) => s === params.status);
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);

  const { rows, total, pageCount } = await listBookings({ status, q: q || undefined, page });

  // Giữ nguyên bộ lọc khi chuyển trang
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    if (q) sp.set("q", q);
    sp.set("page", String(p));
    return `/admin/bookings?${sp}`;
  };

  return (
    <>
      {/* Form GET thường: gửi đi = đổi URL → trang đọc lại searchParams. Không cần JavaScript. */}
      <form className="mt-6 flex flex-wrap gap-3" action="/admin/bookings">
        <select name="status" defaultValue={status ?? ""} className="input w-auto">
          <option value="">Tất cả trạng thái</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input name="q" defaultValue={q} placeholder="Mã đơn, tên, email, SĐT…" className="input w-64 max-w-full" />
        <button className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">
          Lọc
        </button>
      </form>

      <p className="mt-4 text-sm text-stone-500">{total} đơn</p>

      <div className="mt-2 overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-stone-500">
            <tr>
              <th className="px-4 py-2 font-medium">Mã đơn</th>
              <th className="px-4 py-2 font-medium">Khách</th>
              <th className="px-4 py-2 font-medium">Trải nghiệm / Buổi</th>
              <th className="px-4 py-2 text-right font-medium">Số người</th>
              <th className="px-4 py-2 text-right font-medium">Tổng tiền</th>
              <th className="px-4 py-2 font-medium">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((b) => (
              <tr key={b.code} className="hover:bg-stone-50">
                <td className="px-4 py-2 font-mono">
                  <Link href={`/admin/bookings/${b.code}`} className="text-emerald-700 hover:underline">
                    {b.code}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  {b.contactName}
                  <div className="text-xs text-stone-500">{b.contactPhone}</div>
                </td>
                <td className="px-4 py-2">
                  {b.session.experience.title}
                  <div className="text-xs text-stone-500">{formatDateTimeVN(b.session.startsAt)}</div>
                </td>
                <td className="px-4 py-2 text-right">{b.quantity}</td>
                <td className="px-4 py-2 text-right">{formatVND(b.totalAmount)}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={b.status} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-500">
                  Không có đơn nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <nav className="mt-4 flex items-center gap-4 text-sm">
          {page > 1 && <Link href={pageHref(page - 1)} className="text-emerald-700 hover:underline">← Trước</Link>}
          <span className="text-stone-500">
            Trang {page}/{pageCount}
          </span>
          {page < pageCount && <Link href={pageHref(page + 1)} className="text-emerald-700 hover:underline">Sau →</Link>}
        </nav>
      )}
    </>
  );
}
