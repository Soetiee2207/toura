import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { logout } from "./actions";

// Khung chung cho mọi trang quản trị. "(panel)" là ROUTE GROUP: ngoặc tròn → không xuất hiện trên URL.
// app/admin/(panel)/page.tsx vẫn là /admin, nhưng /admin/login thì KHÔNG dùng layout này.
export default function AdminPanelLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-full bg-stone-100">
      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4 text-sm">
          <span className="font-semibold text-stone-900">Quản trị</span>
          <nav className="flex gap-4 text-stone-600">
            <Link href="/admin" className="hover:text-stone-900">
              Tổng quan
            </Link>
          </nav>
          <div className="ml-auto">
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
    </div>
  );
}

async function UserMenu() {
  const user = await requireUser();
  return (
    <form action={logout} className="flex items-center gap-3">
      <span className="text-stone-600">
        {user.name} <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">{user.role}</span>
      </span>
      <button type="submit" className="text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline">
        Đăng xuất
      </button>
    </form>
  );
}
