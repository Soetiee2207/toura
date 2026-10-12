// Luật kiểm tra dữ liệu khách nhập khi đặt chỗ (validation), viết bằng zod.
// File này KHÔNG import gì của server → sau này form phía trình duyệt cũng dùng lại được để báo lỗi tức thì.
// Nhưng server LUÔN kiểm tra lại, vì dữ liệu từ trình duyệt có thể bị sửa.
import { z } from "zod";

export const MAX_TICKETS_PER_BOOKING = 10;

// Số di động Việt Nam: 0xxxxxxxxx hoặc +84xxxxxxxxx (đầu số 3, 5, 7, 8, 9).
// Cho phép khách gõ có dấu cách/chấm ("090 123 4567") → bỏ đi trước khi kiểm tra.
const vnPhone = z
  .string()
  .transform((s) => s.replace(/[\s.-]/g, ""))
  .pipe(z.string().regex(/^(0|\+84)(3|5|7|8|9)\d{8}$/, "Số điện thoại không hợp lệ"))
  .transform((s) => s.replace(/^\+84/, "0")); // chuẩn hoá về dạng 0xxxxxxxxx

export const createBookingSchema = z.object({
  // Mã do server sinh sẵn khi mở trang đặt chỗ, form gửi kèm. Gửi lặp cùng mã → không tạo đơn mới.
  idempotencyKey: z.uuid("Phiên đặt chỗ không hợp lệ, vui lòng tải lại trang"),
  sessionId: z.uuid("Buổi tổ chức không hợp lệ"),
  quantity: z.coerce // dữ liệu form luôn là chuỗi → ép sang số
    .number("Số người không hợp lệ")
    .int("Số người không hợp lệ")
    .min(1, "Cần ít nhất 1 người")
    .max(MAX_TICKETS_PER_BOOKING, `Tối đa ${MAX_TICKETS_PER_BOOKING} người mỗi đơn`),
  contactName: z
    .string()
    .trim()
    .min(2, "Vui lòng nhập họ tên")
    .max(100, "Họ tên quá dài"),
  contactEmail: z.string().trim().toLowerCase().pipe(z.email("Email không hợp lệ")),
  contactPhone: vnPhone,
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
