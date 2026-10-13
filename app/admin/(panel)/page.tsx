import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// /admin — trang tổng quan. Bước sau sẽ thêm trang quản lý đơn.
export default function AdminHomePage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-stone-200" />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const user = await requireUser(); // KHÔNG dựa vào proxy.ts — mỗi trang tự kiểm tra

  const counts = await prisma.booking.groupBy({ by: ["status"], _count: { _all: true } });
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Xin chào, {user.name}</h1>
      <ul className="mt-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Đang giữ chỗ" value={count("PENDING")} accent="text-amber-700" />
        <Stat label="Đã xác nhận" value={count("CONFIRMED")} accent="text-emerald-700" />
        <Stat label="Đã huỷ" value={count("CANCELLED")} accent="text-stone-600" />
        <Stat label="Hết hạn" value={count("EXPIRED")} accent="text-stone-600" />
      </ul>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <li className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-sm text-stone-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${accent}`}>{value}</p>
    </li>
  );
}
