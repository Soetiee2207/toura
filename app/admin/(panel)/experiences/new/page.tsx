import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { ExperienceForm } from "../experience-form";

// /admin/experiences/new — tạo trải nghiệm. Tạo xong sẽ chuyển sang trang sửa để thêm buổi.
export default function NewExperiencePage() {
  return (
    <div className="max-w-2xl">
      <Link href="/admin/experiences" className="text-sm text-stone-500 hover:text-stone-900">
        ← Danh sách trải nghiệm
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Thêm trải nghiệm</h1>
      <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-xl bg-stone-200" />}>
        <Guarded />
      </Suspense>
    </div>
  );
}

async function Guarded() {
  await requireUser(["ADMIN"]);
  return (
    <section className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
      <ExperienceForm />
    </section>
  );
}
