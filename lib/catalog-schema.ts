// Luật kiểm tra dữ liệu admin nhập cho TRẢI NGHIỆM và BUỔI (zod).
// Như lib/booking-schema.ts: không import gì của server; server luôn kiểm tra lại.
// Luật cần "giờ hiện tại" hay cần đọc DB (buổi phải ở tương lai, slug trùng...) nằm ở lib/catalog-admin.ts.
import { z } from "zod";
import { parseVNDateTimeInput } from "@/lib/format";

export const MAX_SESSION_CAPACITY = 500;
const MAX_PRICE = 100_000_000;

// "Tour Ẩm thực Phố cổ!" → "tour-am-thuc-pho-co" (dùng trên URL /experiences/<slug>)
export function slugify(text: string): string {
  return text
    .replace(/[đĐ]/g, "d")
    .normalize("NFD") // tách chữ và dấu: "ẩ" → "a" + dấu mũ + dấu hỏi
    .replace(/[̀-ͯ]/g, "") // bỏ các dấu
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const intField = (label: string, min: number, max: number) =>
  z.coerce // dữ liệu form luôn là chuỗi → ép sang số
    .number(`${label} không hợp lệ`)
    .int(`${label} phải là số nguyên`)
    .min(min, `${label} tối thiểu là ${min.toLocaleString("vi-VN")}`)
    .max(max, `${label} tối đa là ${max.toLocaleString("vi-VN")}`);

export const experienceSchema = z
  .object({
    title: z.string().trim().min(3, "Tên cần ít nhất 3 ký tự").max(200, "Tên quá dài"),
    // Để trống → tự sinh từ tên
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^([a-z0-9]+(-[a-z0-9]+)*)?$/, "Chỉ gồm chữ thường không dấu, số và dấu gạch ngang"),
    description: z.string().trim().min(10, "Mô tả cần ít nhất 10 ký tự").max(5000, "Mô tả quá dài"),
    meetingPoint: z.string().trim().min(3, "Vui lòng nhập điểm hẹn").max(300, "Điểm hẹn quá dài"),
    durationMinutes: intField("Thời lượng", 15, 24 * 60),
    defaultPrice: intField("Giá mặc định", 0, MAX_PRICE),
    isPublished: z.stringbool(), // checkbox: "on" khi tick, form gửi "off" khi không tick
  })
  .transform((d) => ({ ...d, slug: d.slug || slugify(d.title) }))
  .refine((d) => d.slug.length > 0, { path: ["slug"], message: "Không tạo được slug từ tên, vui lòng nhập tay" });

export type ExperienceInput = z.infer<typeof experienceSchema>;

const vnDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Ngày giờ không hợp lệ")
  .transform(parseVNDateTimeInput)
  .refine((d) => !Number.isNaN(d.getTime()), "Ngày giờ không hợp lệ");

export const createSessionSchema = z.object({
  experienceId: z.uuid(),
  startsAt: vnDateTime,
  capacity: intField("Sức chứa", 1, MAX_SESSION_CAPACITY),
  price: intField("Giá", 0, MAX_PRICE),
  status: z.enum(["DRAFT", "OPEN"], "Trạng thái không hợp lệ"),
});

export const updateSessionSchema = z.object({
  sessionId: z.uuid(),
  capacity: intField("Sức chứa", 1, MAX_SESSION_CAPACITY),
  price: intField("Giá", 0, MAX_PRICE),
  status: z.enum(["DRAFT", "OPEN", "CLOSED", "CANCELLED"], "Trạng thái không hợp lệ"),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
