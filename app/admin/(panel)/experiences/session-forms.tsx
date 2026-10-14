"use client";

import { useActionState } from "react";
import { Field } from "@/components/field";
import type { SessionStatus } from "@/generated/prisma/enums";
import { formatDateTimeVN } from "@/lib/format";
import { type CatalogFormState, createSessionAction, updateSessionAction } from "./actions";

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  DRAFT: "Nháp (chưa bán)",
  OPEN: "Đang mở bán",
  CLOSED: "Tạm ngừng bán",
  CANCELLED: "Đã huỷ",
};

// ── Thêm buổi mới ──
export function CreateSessionForm({ experienceId, defaultPrice }: { experienceId: string; defaultPrice: number }) {
  const [state, formAction, pending] = useActionState<CatalogFormState, FormData>(createSessionAction, {});
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};

  return (
    <form action={formAction} className="grid items-start gap-3 sm:grid-cols-[1.4fr_1fr_1fr_1.2fr_6.5rem]" noValidate>
      <input type="hidden" name="experienceId" value={experienceId} />
      <Field label="Bắt đầu (giờ VN)" error={err.startsAt}>
        <input name="startsAt" type="datetime-local" defaultValue={v.startsAt} className="input" />
      </Field>
      <Field label="Sức chứa" error={err.capacity}>
        <input name="capacity" type="number" min={1} defaultValue={v.capacity ?? "10"} className="input" />
      </Field>
      <Field label="Giá (VND)" error={err.price}>
        <input name="price" type="number" min={0} step={1000} defaultValue={v.price ?? defaultPrice} className="input" />
      </Field>
      <Field label="Trạng thái" error={err.status}>
        <select name="status" defaultValue={v.status ?? "OPEN"} className="input">
          <option value="OPEN">{SESSION_STATUS_LABEL.OPEN}</option>
          <option value="DRAFT">{SESSION_STATUS_LABEL.DRAFT}</option>
        </select>
      </Field>
      <div className="sm:pt-6">
        <button
          disabled={pending}
          className="w-full rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? "Đang thêm…" : "Thêm buổi"}
        </button>
      </div>
      {(state.error || state.success) && (
        <p className={`text-sm sm:col-span-5 ${state.error ? "text-red-700" : "text-emerald-700"}`}>
          {state.error ?? state.success}
        </p>
      )}
    </form>
  );
}

// ── Một dòng buổi: sửa sức chứa / giá / trạng thái ──
export type SessionRowData = {
  id: string;
  startsAt: Date;
  capacity: number;
  seatsBooked: number;
  price: number;
  status: SessionStatus;
};

export function SessionRow({ session, statusOptions }: { session: SessionRowData; statusOptions: SessionStatus[] }) {
  const [state, formAction, pending] = useActionState<CatalogFormState, FormData>(updateSessionAction, {});
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const isPast = session.startsAt <= new Date();
  const readOnly = session.status === "CANCELLED";

  return (
    <form action={formAction} className="grid items-start gap-3 py-3 sm:grid-cols-[1.4fr_1fr_1fr_1.2fr_6.5rem]" noValidate>
      <input type="hidden" name="sessionId" value={session.id} />
      <div className="text-sm">
        <p className="font-medium">{formatDateTimeVN(session.startsAt)}</p>
        <p className="text-xs text-stone-500">
          Đã giữ {session.seatsBooked}/{session.capacity} chỗ{isPast && " · đã diễn ra"}
        </p>
      </div>
      {readOnly ? (
        <p className="text-sm text-stone-500 sm:col-span-4">{SESSION_STATUS_LABEL.CANCELLED}</p>
      ) : (
        <>
          <div>
            <input
              name="capacity"
              type="number"
              min={Math.max(1, session.seatsBooked)}
              defaultValue={v.capacity ?? session.capacity}
              aria-label="Sức chứa"
              className="input"
            />
            {err.capacity && <p className="mt-1 text-xs text-red-700">{err.capacity}</p>}
          </div>
          <div>
            <input name="price" type="number" min={0} step={1000} defaultValue={v.price ?? session.price} aria-label="Giá" className="input" />
            {err.price && <p className="mt-1 text-xs text-red-700">{err.price}</p>}
          </div>
          <div>
            <select name="status" defaultValue={v.status ?? session.status} aria-label="Trạng thái" className="input">
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {SESSION_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            {err.status && <p className="mt-1 text-xs text-red-700">{err.status}</p>}
          </div>
          <div className="flex flex-col items-start gap-1">
            <button
              disabled={pending}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50 disabled:opacity-50"
            >
              {pending ? "…" : "Lưu"}
            </button>
            {state.success && <span className="text-xs text-emerald-700">{state.success}</span>}
          </div>
          {state.error && <p className="text-sm text-red-700 sm:col-span-5">{state.error}</p>}
        </>
      )}
    </form>
  );
}
