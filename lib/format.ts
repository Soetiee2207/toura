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
