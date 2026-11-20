// Tính tiền của MỘT đơn từ danh sách khoản thanh toán. Hàm thuần (không đụng DB) → dùng chung cho
// webhook (lib/payments.ts quyết định đủ/thiếu) và trang khách (lib/booking.ts hiện "còn phải chuyển")
// → hai nơi KHÔNG BAO GIỜ tính lệch nhau.
import type { PaymentStatus } from "@/generated/prisma/enums";

export type PaymentRow = { amount: number; status: PaymentStatus; refundAmount: number | null };

export function summarizePayments(payments: PaymentRow[]) {
  let kept = 0; // tiền đơn ĐANG GIỮ = đã thu, trừ phần đã/đang chờ hoàn
  let refundPending = 0; // tiền đang chờ hoàn cho khách
  for (const p of payments) {
    if (p.status === "SUCCEEDED" || p.status === "REFUND_PENDING") kept += p.amount - (p.refundAmount ?? 0);
    if (p.status === "REFUND_PENDING") refundPending += p.refundAmount ?? 0;
  }
  return { kept, refundPending };
}
