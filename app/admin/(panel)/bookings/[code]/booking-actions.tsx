"use client";

import { useActionState } from "react";
import { type BookingActionState, cancelBookingAction, confirmBookingAction } from "../actions";

// Nút Xác nhận / Huỷ. Client Component vì cần useActionState (hiện kết quả, khoá nút khi đang gửi).
export function BookingActions(props: { bookingId: string; canConfirm: boolean; canCancel: boolean }) {
  const [confirmState, confirmAction, confirming] = useActionState<BookingActionState, FormData>(confirmBookingAction, {});
  const [cancelState, cancelAction, cancelling] = useActionState<BookingActionState, FormData>(cancelBookingAction, {});
  const pending = confirming || cancelling;
  const success = confirmState.success ?? cancelState.success;

  if (!props.canConfirm && !props.canCancel) {
    return success ? <p className="mt-6 text-sm text-emerald-700">{success}</p> : null;
  }

  return (
    <div className="mt-6 space-y-4 border-t border-stone-200 pt-4">
      {props.canConfirm && (
        <form action={confirmAction}>
          <input type="hidden" name="bookingId" value={props.bookingId} />
          <button
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {confirming ? "Đang xác nhận…" : "Xác nhận đơn"}
          </button>
          <ErrorText message={confirmState.error} />
        </form>
      )}

      {props.canCancel && (
        <form
          action={cancelAction}
          onSubmit={(e) => {
            if (!window.confirm("Huỷ đơn này và trả lại chỗ?")) e.preventDefault();
          }}
          className="flex flex-wrap gap-2"
        >
          <input type="hidden" name="bookingId" value={props.bookingId} />
          <input name="reason" required minLength={3} placeholder="Lý do huỷ" className="input w-64 max-w-full" />
          <button
            disabled={pending}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {cancelling ? "Đang huỷ…" : "Huỷ đơn"}
          </button>
          <ErrorText message={cancelState.error} />
        </form>
      )}
    </div>
  );
}

function ErrorText({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-2 w-full text-sm text-red-700">
      {message}
    </p>
  );
}
