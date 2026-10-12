"use client";
// ↑ Client Component: code này được gửi xuống và CHẠY TRONG TRÌNH DUYỆT,
//   nên dùng được useState để phản hồi ngay khi khách bấm, không cần tải lại trang.
//   Đổi lại: KHÔNG được import prisma hay bất cứ thứ gì bí mật ở đây.

import Link from "next/link";
import { useState } from "react";
import type { BookableSession } from "@/lib/catalog";
import { formatVND } from "@/lib/format";

const MAX_PER_BOOKING = 10; // giới hạn số vé mỗi đơn (server cũng sẽ kiểm tra lại ở bước đặt vé)

export function SessionPicker({ sessions }: { sessions: BookableSession[] }) {
  const [selectedId, setSelectedId] = useState(sessions[0].id);
  const [quantity, setQuantity] = useState(1);

  const selected = sessions.find((s) => s.id === selectedId) ?? sessions[0];
  const maxQuantity = Math.min(selected.seatsLeft, MAX_PER_BOOKING);

  function selectSession(id: string) {
    setSelectedId(id);
    // Buổi mới có thể còn ít chỗ hơn số người đang chọn → kéo xuống cho hợp lệ
    const next = sessions.find((s) => s.id === id);
    if (next) setQuantity((q) => Math.min(q, next.seatsLeft, MAX_PER_BOOKING));
  }

  return (
    <div className="mt-3">
      <fieldset>
        <legend className="sr-only">Buổi tổ chức</legend>
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {sessions.map((s) => {
            const active = s.id === selectedId;
            return (
              <li key={s.id}>
                <label
                  className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
                    active
                      ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600"
                      : "border-stone-200 hover:border-stone-300"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="session"
                      value={s.id}
                      checked={active}
                      onChange={() => selectSession(s.id)}
                      className="accent-emerald-600"
                    />
                    <span className="font-medium">{s.startsAtLabel}</span>
                  </span>
                  <span className={s.seatsLeft <= 3 ? "text-amber-700" : "text-stone-500"}>
                    còn {s.seatsLeft} chỗ
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm font-medium">Số người</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setQuantity((q) => q - 1)}
            disabled={quantity <= 1}
            aria-label="Giảm số người"
            className="h-9 w-9 rounded-full border border-stone-300 text-lg disabled:opacity-30"
          >
            −
          </button>
          <span className="w-6 text-center font-semibold" aria-live="polite">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => q + 1)}
            disabled={quantity >= maxQuantity}
            aria-label="Tăng số người"
            className="h-9 w-9 rounded-full border border-stone-300 text-lg disabled:opacity-30"
          >
            +
          </button>
        </div>
      </div>

      <div className="mt-5 flex items-baseline justify-between border-t border-stone-200 pt-4">
        <span className="text-sm text-stone-600">
          {formatVND(selected.price)} × {quantity}
        </span>
        <span className="text-xl font-bold text-emerald-700">
          {formatVND(selected.price * quantity)}
        </span>
      </div>

      {/* Bước sau sẽ làm trang /book. Giá ở đây CHỈ ĐỂ HIỂN THỊ — server sẽ tự tính lại, không tin số từ trình duyệt. */}
      <Link
        href={`/book?session=${selected.id}&qty=${quantity}`}
        className="mt-4 block rounded-lg bg-emerald-700 px-4 py-3 text-center font-semibold text-white transition hover:bg-emerald-800"
      >
        Tiếp tục đặt chỗ
      </Link>
    </div>
  );
}
