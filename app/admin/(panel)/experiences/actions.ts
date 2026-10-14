"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { CatalogError, createExperience, createSession, updateExperience, updateSession } from "@/lib/catalog-admin";
import { createSessionSchema, experienceSchema, updateSessionSchema } from "@/lib/catalog-schema";

export type CatalogFormState = {
  error?: string; // lỗi chung
  success?: string;
  fieldErrors?: Record<string, string>; // lỗi gắn với từng ô
  values?: Record<string, string>; // giữ lại dữ liệu đã gõ khi có lỗi
};

// Quản lý danh mục: CHỈ ADMIN. Mỗi action tự kiểm tra — không dựa vào việc trang đã ẩn nút hay proxy.ts.
const ADMIN_ONLY = ["ADMIN"] as const;

export async function saveExperienceAction(_prev: CatalogFormState, formData: FormData): Promise<CatalogFormState> {
  const user = await requireUser([...ADMIN_ONLY]);
  const values = pick(formData, ["title", "slug", "description", "meetingPoint", "durationMinutes", "defaultPrice"]);
  // Checkbox: tick → trình duyệt gửi "on"; không tick → KHÔNG gửi gì cả
  const isPublished = formData.get("isPublished") ? "on" : "off";
  const id = String(formData.get("id") ?? ""); // rỗng = tạo mới

  const parsed = experienceSchema.safeParse({ ...values, isPublished });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values: { ...values, isPublished } };
  if (id && !z.uuid().safeParse(id).success) return { error: "Yêu cầu không hợp lệ." };

  let createdId: string | undefined;
  try {
    if (id) await updateExperience(user, id, parsed.data);
    else createdId = (await createExperience(user, parsed.data)).id;
  } catch (e) {
    return { ...toErrorState(e), values: { ...values, isPublished } };
  }

  if (createdId) redirect(`/admin/experiences/${createdId}`); // tạo xong → sang trang sửa để thêm buổi
  refresh();
  return { success: "Đã lưu thay đổi." };
}

export async function createSessionAction(_prev: CatalogFormState, formData: FormData): Promise<CatalogFormState> {
  const user = await requireUser([...ADMIN_ONLY]);
  const values = pick(formData, ["experienceId", "startsAt", "capacity", "price", "status"]);

  const parsed = createSessionSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };

  try {
    await createSession(user, parsed.data);
  } catch (e) {
    return { ...toErrorState(e), values };
  }
  refresh();
  return { success: "Đã thêm buổi." };
}

export async function updateSessionAction(_prev: CatalogFormState, formData: FormData): Promise<CatalogFormState> {
  const user = await requireUser([...ADMIN_ONLY]);
  const values = pick(formData, ["sessionId", "capacity", "price", "status"]);

  const parsed = updateSessionSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };

  try {
    await updateSession(user, parsed.data);
  } catch (e) {
    return { ...toErrorState(e), values };
  }
  refresh();
  return { success: "Đã lưu." };
}

// ── tiện ích ──

function pick(formData: FormData, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, String(formData.get(k) ?? "")]));
}

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message; // lỗi đầu tiên của mỗi ô
  return out;
}

function toErrorState(e: unknown): CatalogFormState {
  if (e instanceof CatalogError) return e.field ? { fieldErrors: { [e.field]: e.message } } : { error: e.message };
  console.error("[catalog-admin] lỗi không mong đợi:", e);
  return { error: "Có lỗi xảy ra, vui lòng thử lại." };
}
