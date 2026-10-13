"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate, startSession } from "@/lib/auth";

export type LoginState = { error?: string; email?: string };

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const parsed = loginSchema.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) return { error: "Vui lòng nhập email và mật khẩu hợp lệ.", email };

  const user = await authenticate(parsed.data.email, parsed.data.password);
  // Thông báo CHUNG: không nói "email không tồn tại" hay "sai mật khẩu" → kẻ gian không dò được email
  if (!user) return { error: "Email hoặc mật khẩu không đúng.", email };

  await startSession(user.id);
  redirect("/admin");
}
