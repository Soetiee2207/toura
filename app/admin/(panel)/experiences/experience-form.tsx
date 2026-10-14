"use client";

import { useActionState } from "react";
import { Field } from "@/components/field";
import { type CatalogFormState, saveExperienceAction } from "./actions";

export type ExperienceFormData = {
  id: string;
  title: string;
  slug: string;
  description: string;
  meetingPoint: string;
  durationMinutes: number;
  defaultPrice: number;
  isPublished: boolean;
};

// Dùng chung cho TẠO MỚI (experience = undefined) và SỬA.
export function ExperienceForm({ experience }: { experience?: ExperienceFormData }) {
  const [state, formAction, pending] = useActionState<CatalogFormState, FormData>(saveExperienceAction, {});
  const err = state.fieldErrors ?? {};
  // Có lỗi → hiện lại đúng cái admin vừa gõ; không thì lấy dữ liệu hiện tại trong DB
  const v = (key: keyof ExperienceFormData) => state.values?.[key] ?? String(experience?.[key] ?? "");
  const published = state.values ? state.values.isPublished === "on" : (experience?.isPublished ?? false);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="id" value={experience?.id ?? ""} />

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <Field label="Tên trải nghiệm" error={err.title}>
        <input name="title" defaultValue={v("title")} className="input" />
      </Field>
      <Field label="Slug (đường dẫn)" error={err.slug} hint="Để trống → tự tạo từ tên. Đổi slug sẽ làm hỏng các link cũ đã gửi cho khách.">
        <input name="slug" defaultValue={v("slug")} placeholder="tu-dong-tao-tu-ten" className="input font-mono" />
      </Field>
      <Field label="Mô tả" error={err.description}>
        <textarea name="description" defaultValue={v("description")} rows={5} className="input" />
      </Field>
      <Field label="Điểm hẹn" error={err.meetingPoint}>
        <input name="meetingPoint" defaultValue={v("meetingPoint")} className="input" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Thời lượng (phút)" error={err.durationMinutes}>
          <input name="durationMinutes" type="number" min={15} step={15} defaultValue={v("durationMinutes")} className="input" />
        </Field>
        <Field label="Giá mặc định (VND/người)" error={err.defaultPrice} hint="Gợi ý sẵn khi tạo buổi mới.">
          <input name="defaultPrice" type="number" min={0} step={1000} defaultValue={v("defaultPrice")} className="input" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input name="isPublished" type="checkbox" defaultChecked={published} className="size-4 accent-emerald-700" />
        Công khai trên trang khách
      </label>

      <div className="flex items-center gap-3">
        <button
          disabled={pending}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {pending ? "Đang lưu…" : experience ? "Lưu thay đổi" : "Tạo trải nghiệm"}
        </button>
        {state.success && <span className="text-sm text-emerald-700">{state.success}</span>}
      </div>
    </form>
  );
}
