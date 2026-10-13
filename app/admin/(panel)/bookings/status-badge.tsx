import type { BookingStatus } from "@/generated/prisma/enums";

export const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: "Đang giữ chỗ",
  CONFIRMED: "Đã xác nhận",
  CANCELLED: "Đã huỷ",
  EXPIRED: "Hết hạn",
};

const STATUS_CLASS: Record<BookingStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-stone-200 text-stone-700",
  EXPIRED: "bg-stone-200 text-stone-700",
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
