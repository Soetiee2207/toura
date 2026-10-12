"use server";
// ↑ Server Action: hàm chạy trên SERVER nhưng form ở trình duyệt gọi trực tiếp được
//   (Next.js tự tạo một endpoint POST ẩn). Không cần tự viết API.
//   ⚠️ Vì là endpoint công khai, ai cũng gửi request thẳng vào được → PHẢI validate mọi thứ.

import { redirect } from "next/navigation";
import { BookingError, createBooking } from "@/lib/booking";
import { createBookingSchema } from "@/lib/booking-schema";

// Trạng thái trả về cho form khi có lỗi (thành công thì redirect, không trả về gì)
export type BookingFormState = {
  formError?: string; // lỗi chung (hết chỗ, buổi đã đóng...)
  fieldErrors?: Partial<Record<"contactName" | "contactEmail" | "contactPhone" | "quantity", string>>;
  values?: Record<string, string>; // giữ lại dữ liệu khách đã gõ để không phải gõ lại
};

export async function submitBooking(_prev: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const raw = Object.fromEntries(
    ["sessionId", "quantity", "contactName", "contactEmail", "contactPhone"].map((k) => [k, String(formData.get(k) ?? "")]),
  );

  // 1. VALIDATE — dữ liệu từ trình duyệt không bao giờ được tin
  const parsed = createBookingSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: BookingFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof NonNullable<BookingFormState["fieldErrors"]>;
      fieldErrors[field] ??= issue.message; // giữ lỗi đầu tiên của mỗi ô
    }
    return { fieldErrors, values: raw };
  }

  // 2. GỌI TẦNG NGHIỆP VỤ — mọi quy tắc nằm trong lib/booking.ts
  let code: string;
  try {
    ({ code } = await createBooking(parsed.data));
  } catch (e) {
    if (e instanceof BookingError) return { formError: e.message, values: raw };
    console.error("createBooking failed", e); // lỗi bất ngờ: ghi log cho dev, không lộ chi tiết cho khách
    return { formError: "Có lỗi xảy ra, bạn vui lòng thử lại sau ít phút.", values: raw };
  }

  // 3. THÀNH CÔNG → chuyển sang trang đơn. (redirect phải nằm NGOÀI try/catch vì nó hoạt động bằng cách throw)
  redirect(`/bookings/${code}`);
}
