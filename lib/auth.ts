// Xác thực & phân quyền nhân viên/quản trị — "Data Access Layer" cho danh tính.
// Mọi trang /admin và MỌI Server Action của admin phải gọi requireUser() — không dựa vào proxy.ts.
import "server-only"; // import nhầm file này vào Client Component → build báo lỗi ngay

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import type { UserRole } from "@/generated/prisma/enums";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { createSessionToken, SESSION_MAX_AGE_SECONDS, verifySessionToken } from "@/lib/session-token";

export const SESSION_COOKIE = "toura_session";

// Chỉ trả về những gì giao diện cần — KHÔNG bao giờ trả passwordHash ra ngoài.
export type CurrentUser = { id: string; name: string; email: string; role: UserRole };

// ── Đăng nhập ──────────────────────────────────────────────

// Hash giả để so sánh khi email không tồn tại → thời gian phản hồi giống hệt trường hợp sai mật khẩu.
// Nếu không, kẻ gian đo thời gian là biết email nào CÓ trong hệ thống.
const dummyHashPromise = hashPassword("dummy-password-for-timing");

export async function authenticate(email: string, password: string): Promise<CurrentUser | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, name: true, email: true, role: true, isActive: true, passwordHash: true },
  });

  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHashPromise));
  if (!user || !ok || !user.isActive) return null; // không nói rõ sai email hay sai mật khẩu

  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function startSession(userId: string) {
  (await cookies()).set(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true, // JavaScript trên trang KHÔNG đọc được cookie → chống đánh cắp qua XSS
    secure: process.env.NODE_ENV === "production", // chỉ gửi qua HTTPS (trên máy dev dùng http nên tắt)
    sameSite: "lax", // trang web khác không gửi kèm cookie khi POST sang → chống CSRF
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

// ── Đọc người dùng hiện tại ───────────────────────────────

// cache() của React: trong CÙNG một lần render, gọi nhiều lần chỉ truy vấn DB một lần.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Kiểm tra hạn token dùng giờ hiện tại → báo Next.js: phần này luôn chạy lúc có request, không dựng sẵn
  await connection();
  const payload = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!payload) return null;

  // Luôn kiểm tra lại DB: tài khoản bị khoá (isActive = false) thì mất quyền NGAY, dù cookie còn hạn.
  const user = await prisma.user.findUnique({
    where: { id: payload.uid },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;

  return { id: user.id, name: user.name, email: user.email, role: user.role };
});

// Bắt buộc đăng nhập (và đúng vai trò nếu truyền roles). Không đạt → chuyển về trang đăng nhập.
export async function requireUser(roles?: UserRole[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  if (roles && !roles.includes(user.role)) redirect("/admin?error=forbidden");
  return user;
}
