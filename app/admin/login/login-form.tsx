"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Email</span>
        <input name="email" type="email" defaultValue={state.email} autoComplete="username" required className="input" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Mật khẩu</span>
        <input name="password" type="password" autoComplete="current-password" required className="input" />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-stone-900 px-4 py-2.5 font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
      >
        {pending ? "Đang đăng nhập…" : "Đăng nhập"}
      </button>
    </form>
  );
}
