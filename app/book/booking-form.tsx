"use client";
// Form đặt chỗ. Client Component vì cần: hiện trạng thái "đang gửi", hiện lỗi ngay dưới từng ô.

import { useActionState, useState } from "react";
import { Field } from "@/components/field";
import { MAX_TICKETS_PER_BOOKING } from "@/lib/booking-schema";
import { formatVND } from "@/lib/format";
import { submitBooking, type BookingFormState } from "./actions";

type Props = {
  idempotencyKey: string; // server sinh sẵn — xem app/book/page.tsx
  sessionId: string;
  price: number; // chỉ để HIỂN THỊ tổng tiền tạm tính
  seatsLeft: number;
  initialQuantity: number;
};

export function BookingForm({ idempotencyKey, sessionId, price, seatsLeft, initialQuantity }: Props) {
  // useActionState: gắn Server Action vào form, nhận lại state (lỗi) và cờ pending (đang gửi)
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(submitBooking, {});
  const maxQuantity = Math.min(seatsLeft, MAX_TICKETS_PER_BOOKING);
  const [quantity, setQuantity] = useState(Math.min(Math.max(initialQuantity, 1), maxQuantity));

  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="sessionId" value={sessionId} />

      {state.formError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.formError}
        </p>
      )}

      <Field label="Số người" error={err.quantity}>
        {/* React 19 tự reset <form> sau mỗi lần gửi → dùng defaultValue (không dùng value)
            để sau khi reset, ô này quay về đúng số khách đã chọn chứ không nhảy về 1. */}
        <select
          name="quantity"
          defaultValue={v.quantity ?? quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
          className="input"
        >
          {Array.from({ length: maxQuantity }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} người
            </option>
          ))}
        </select>
      </Field>

      <Field label="Họ và tên" error={err.contactName}>
        <input name="contactName" defaultValue={v.contactName} autoComplete="name" className="input" />
      </Field>
      <Field label="Email" error={err.contactEmail}>
        <input name="contactEmail" type="email" defaultValue={v.contactEmail} autoComplete="email" className="input" />
      </Field>
      <Field label="Số điện thoại" error={err.contactPhone}>
        <input name="contactPhone" type="tel" defaultValue={v.contactPhone} autoComplete="tel" placeholder="09xx xxx xxx" className="input" />
      </Field>

      <div className="flex items-baseline justify-between border-t border-stone-200 pt-4">
        <span className="text-sm text-stone-600">Tạm tính</span>
        <span className="text-xl font-bold text-emerald-700">{formatVND(price * quantity)}</span>
      </div>

      <button
        type="submit"
        disabled={pending} // chặn bấm 2 lần → tránh tạo 2 đơn trùng
        className="w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Đang giữ chỗ…" : "Đặt chỗ"}
      </button>
      <p className="text-center text-xs text-stone-500">
        Chưa cần thanh toán. Chúng tôi sẽ liên hệ để xác nhận đơn.
      </p>
    </form>
  );
}
