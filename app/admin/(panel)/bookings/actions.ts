"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { AdminBookingError, cancelBooking, confirmBooking } from "@/lib/booking-admin";

export type BookingActionState = { error?: string; success?: string };

// Server Action = một cổng POST công khai: ai cũng gọi thẳng được, không cần mở trang.
// → MỖI action tự gọi requireUser() ở dòng đầu tiên, không trông chờ proxy.ts hay trang đã kiểm tra.
const confirmSchema = z.object({ bookingId: z.uuid() });
const cancelSchema = z.object({
  bookingId: z.uuid(),
  reason: z.string().trim().min(3, "Lý do cần ít nhất 3 ký tự.").max(500, "Lý do tối đa 500 ký tự."),
});

export async function confirmBookingAction(_prev: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const user = await requireUser(["STAFF", "ADMIN"]);
  const parsed = confirmSchema.safeParse({ bookingId: formData.get("bookingId") });
  if (!parsed.success) return { error: "Yêu cầu không hợp lệ." };

  return run(() => confirmBooking(parsed.data.bookingId, user), "Đã xác nhận đơn.");
}

export async function cancelBookingAction(_prev: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const user = await requireUser(["STAFF", "ADMIN"]);
  const parsed = cancelSchema.safeParse({ bookingId: formData.get("bookingId"), reason: formData.get("reason") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Yêu cầu không hợp lệ." };

  return run(() => cancelBooking(parsed.data.bookingId, user, parsed.data.reason), "Đã huỷ đơn và trả lại chỗ.");
}

// Chạy nghiệp vụ, đổi lỗi thành thông báo cho nhân viên, rồi refresh() để trang tải lại dữ liệu mới
async function run(task: () => Promise<void>, success: string): Promise<BookingActionState> {
  try {
    await task();
  } catch (e) {
    if (e instanceof AdminBookingError) return { error: e.message };
    console.error("[booking-admin] lỗi không mong đợi:", e);
    return { error: "Có lỗi xảy ra, vui lòng thử lại." };
  }
  refresh();
  return { success };
}
