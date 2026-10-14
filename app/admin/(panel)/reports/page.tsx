import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { formatVND } from "@/lib/format";
import { currentMonthVN, getMonthlyReport, isValidMonth, shiftMonth } from "@/lib/reports";

// /admin/reports?month=2026-10 — doanh thu theo tháng. Chỉ ADMIN (doanh thu là thông tin nhạy cảm).
export default function AdminReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Báo cáo doanh thu</h1>
      <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-xl bg-stone-200" />}>
        <Report searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Report({ searchParams }: { searchParams: PageProps<"/admin/reports">["searchParams"] }) {
  await requireUser(["ADMIN"]);
  const params = await searchParams;
  const month = isValidMonth(params.month) ? params.month : currentMonthVN();

  const { rows, totals } = await getMonthlyReport(month);
  const [y, m] = month.split("-");

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href={`/admin/reports?month=${shiftMonth(month, -1)}`} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 hover:border-stone-500">
          ← Tháng trước
        </Link>
        <form className="flex items-center gap-2">
          <input type="month" name="month" defaultValue={month} className="rounded-lg border border-stone-300 bg-white px-2 py-1" />
          <button type="submit" className="rounded-lg bg-stone-900 px-3 py-1.5 font-medium text-white hover:bg-stone-700">
            Xem
          </button>
        </form>
        <Link href={`/admin/reports?month=${shiftMonth(month, 1)}`} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 hover:border-stone-500">
          Tháng sau →
        </Link>
      </div>

      <h2 className="mt-6 text-lg font-semibold">
        Tháng {Number(m)}/{y}
      </h2>
      <ul className="mt-3 grid gap-4 sm:grid-cols-4">
        <Card label="Doanh thu đã xác nhận" value={formatVND(totals.revenue)} accent="text-emerald-700" />
        <Card label="Số khách" value={String(totals.guests)} />
        <Card label="Lấp đầy" value={fillRate(totals.guests, totals.capacity)} hint={`${totals.guests}/${totals.capacity} chỗ · ${totals.sessions} buổi`} />
        <Card label="Đang chờ xác nhận" value={formatVND(totals.pendingAmount)} accent="text-amber-700" hint="Chưa tính vào doanh thu" />
      </ul>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
          Không có buổi nào diễn ra trong tháng này.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-stone-500">
              <tr>
                <th className="px-4 py-2 font-medium">Trải nghiệm</th>
                <th className="px-4 py-2 text-right font-medium">Buổi</th>
                <th className="px-4 py-2 text-right font-medium">Khách</th>
                <th className="px-4 py-2 text-right font-medium">Lấp đầy</th>
                <th className="px-4 py-2 text-right font-medium">Doanh thu</th>
                <th className="px-4 py-2 text-right font-medium">Đang chờ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.experienceId} className="hover:bg-stone-50">
                  <td className="px-4 py-2">
                    <Link href={`/admin/experiences/${r.experienceId}`} className="font-medium text-emerald-700 hover:underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right">{r.sessions}</td>
                  <td className="px-4 py-2 text-right">{r.guests}</td>
                  <td className="px-4 py-2 text-right">{fillRate(r.guests, r.capacity)}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatVND(r.revenue)}</td>
                  <td className="px-4 py-2 text-right text-stone-500">{formatVND(r.pendingAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-stone-500">
        Tính theo ngày diễn ra buổi (giờ Việt Nam). Doanh thu chỉ gồm đơn đã xác nhận; buổi đã huỷ không được tính.
      </p>
    </>
  );
}

// Lấp đầy = khách đã xác nhận / tổng sức chứa. Không có sức chứa → "—" (tránh chia cho 0)
function fillRate(guests: number, capacity: number) {
  return capacity === 0 ? "—" : `${Math.round((guests / capacity) * 100)}%`;
}

function Card({ label, value, hint, accent = "text-stone-900" }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <li className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-sm text-stone-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
    </li>
  );
}
