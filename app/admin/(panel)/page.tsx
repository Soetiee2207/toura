import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// /admin — trang tổng quan. Bấm vào từng ô → danh sách đơn đã lọc theo trạng thái.
export default function AdminHomePage({ searchParams }: PageProps<"/admin">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-stone-200" />}>
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}

async function Overview({ searchParams }: { searchParams: PageProps<"/admin">["searchParams"] }) {
  const user = await requireUser(); // KHÔNG dựa vào proxy.ts — mỗi trang tự kiểm tra
  // requireUser(roles) chuyển về đây với ?error=forbidden khi sai vai trò
  const forbidden = (await searchParams).error === "forbidden";

  const counts = await prisma.booking.groupBy({ by: ["status"], _count: { _all: true } });
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <div>
      {forbidden && (
        <p role="alert" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Bạn không có quyền vào trang đó.
        </p>
      )}
      <h1 className="text-2xl font-bold tracking-tight">Xin chào, {user.name}</h1>
      <ul className="mt-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Đang giữ chỗ" status="PENDING" value={count("PENDING")} accent="text-amber-700" />
        <Stat label="Đã xác nhận" status="CONFIRMED" value={count("CONFIRMED")} accent="text-emerald-700" />
        <Stat label="Đã huỷ" status="CANCELLED" value={count("CANCELLED")} accent="text-stone-600" />
        <Stat label="Hết hạn" status="EXPIRED" value={count("EXPIRED")} accent="text-stone-600" />
      </ul>
    </div>
  );
}

function Stat({ label, status, value, accent }: { label: string; status: string; value: number; accent: string }) {
  return (
    <li>
      <Link
        href={`/admin/bookings?status=${status}`}
        className="block rounded-xl border border-stone-200 bg-white p-4 hover:border-stone-400"
      >
        <p className="text-sm text-stone-500">{label}</p>
        <p className={`mt-1 text-3xl font-bold ${accent}`}>{value}</p>
      </Link>
    </li>
  );
}
