import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

// /admin/login — nằm NGOÀI route group (panel) nên không có thanh điều hướng quản trị
export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Đăng nhập quản trị</h1>
      <p className="mt-1 text-sm text-stone-500">Dành cho nhân viên và quản trị viên Toura.</p>
      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <Suspense fallback={<div className="h-56" />}>
          <RedirectIfLoggedIn />
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}

// Đã đăng nhập rồi mà vào trang login → đưa thẳng vào trang quản trị
async function RedirectIfLoggedIn() {
  if (await getCurrentUser()) redirect("/admin");
  return null;
}
