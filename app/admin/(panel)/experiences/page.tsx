import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { listExperiencesForAdmin } from "@/lib/catalog-admin";
import { formatVND } from "@/lib/format";

// /admin/experiences — danh sách trải nghiệm (cả bản chưa công khai). Chỉ ADMIN.
export default function AdminExperiencesPage() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Trải nghiệm</h1>
        <Link
          href="/admin/experiences/new"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
        >
          + Thêm trải nghiệm
        </Link>
      </div>
      <Suspense fallback={<div className="mt-6 h-64 animate-pulse rounded-xl bg-stone-200" />}>
        <ExperienceList />
      </Suspense>
    </div>
  );
}

async function ExperienceList() {
  await requireUser(["ADMIN"]);
  const experiences = await listExperiencesForAdmin();

  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-stone-500">
          <tr>
            <th className="px-4 py-2 font-medium">Tên</th>
            <th className="px-4 py-2 font-medium">Hiển thị</th>
            <th className="px-4 py-2 text-right font-medium">Giá mặc định</th>
            <th className="px-4 py-2 text-right font-medium">Buổi sắp tới</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {experiences.map((e) => (
            <tr key={e.id} className="hover:bg-stone-50">
              <td className="px-4 py-2">
                <Link href={`/admin/experiences/${e.id}`} className="font-medium text-emerald-700 hover:underline">
                  {e.title}
                </Link>
                <div className="font-mono text-xs text-stone-500">/{e.slug}</div>
              </td>
              <td className="px-4 py-2">
                {e.isPublished ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Công khai</span>
                ) : (
                  <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700">Ẩn</span>
                )}
              </td>
              <td className="px-4 py-2 text-right">{formatVND(e.defaultPrice)}</td>
              <td className="px-4 py-2 text-right">{e._count.sessions}</td>
            </tr>
          ))}
          {experiences.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-stone-500">
                Chưa có trải nghiệm nào.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
