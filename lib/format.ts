// Định dạng hiển thị cho người Việt. Luôn ép múi giờ Việt Nam,
// vì server có thể chạy ở múi giờ khác (Docker mặc định là UTC).
const TIME_ZONE = "Asia/Ho_Chi_Minh";

const vndFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatVND(amount: number): string {
  return vndFormatter.format(amount); // 350000 → "350.000 ₫"
}

export function formatDateTimeVN(date: Date): string {
  return dateTimeFormatter.format(date); // → "18:00 T2, 13/10"
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} phút`;
  return m === 0 ? `${h} giờ` : `${h} giờ ${m} phút`;
}

// Ô <input type="datetime-local"> gửi lên chuỗi "2026-10-20T18:00" — KHÔNG có múi giờ.
// Toura quy ước: mọi giờ nhân viên gõ là giờ Việt Nam. Việt Nam cố định UTC+7, không có giờ mùa hè
// → gắn "+07:00" là đủ, không phụ thuộc múi giờ của máy chủ (Docker thường chạy UTC).
export function parseVNDateTimeInput(value: string): Date {
  return new Date(`${value}:00+07:00`); // "2026-10-20T18:00" giờ VN → thời điểm tuyệt đối
}
