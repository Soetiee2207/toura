import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getExperienceForAdmin, sessionStatusOptions } from "@/lib/catalog-admin";
import { ExperienceForm } from "../experience-form";
import { CreateSessionForm, SessionRow } from "../session-forms";

// /admin/experiences/<id> — sửa trải nghiệm + quản lý các buổi của nó. Chỉ ADMIN.
export default function EditExperiencePage({ params }: PageProps<"/admin/experiences/[id]">) {
  return (
    <div>
      <Link href="/admin/experiences" className="text-sm text-stone-500 hover:text-stone-900">
        ← Danh sách trải nghiệm
      </Link>
      <Suspense fallback={<div className="mt-4 h-96 animate-pulse rounded-xl bg-stone-200" />}>
        <Editor params={params} />
      </Suspense>
    </div>
  );
}

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(["ADMIN"]);
  const { id } = await params;
  const exp = /^[0-9a-f-]{36}$/i.test(id) ? await getExperienceForAdmin(id) : null;
  if (!exp) notFound();

  return (
    <div className="mt-2 space-y-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{exp.title}</h1>
        {exp.isPublished && (
          <Link href={`/experiences/${exp.slug}`} className="text-sm text-emerald-700 hover:underline" target="_blank">
            Xem trang khách ↗
          </Link>
        )}
      </div>

      <section className="max-w-2xl rounded-xl border border-stone-200 bg-white p-5">
        {/* key đổi sau mỗi lần lưu (updatedAt) → React dựng lại form với dữ liệu mới từ DB */}
        <ExperienceForm key={exp.updatedAt.toISOString()} experience={exp} />
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="font-semibold">Các buổi</h2>
        <p className="mt-1 text-sm text-stone-500">
          Đổi giá chỉ áp dụng cho đơn mới. Không thể giảm sức chứa dưới số chỗ đã giữ, hay huỷ buổi khi còn đơn.
        </p>

        <div className="mt-4 rounded-lg bg-stone-50 p-4">
          <CreateSessionForm experienceId={exp.id} defaultPrice={exp.defaultPrice} />
        </div>

        <div className="mt-4 hidden grid-cols-[1.4fr_1fr_1fr_1.2fr_6.5rem] gap-3 text-xs font-medium text-stone-500 sm:grid">
          <span>Buổi</span>
          <span>Sức chứa</span>
          <span>Giá (VND)</span>
          <span>Trạng thái</span>
          <span />
        </div>
        <div className="divide-y divide-stone-100">
          {exp.sessions.map((s) => (
            <SessionRow
              key={`${s.id}-${s.updatedAt.toISOString()}`}
              session={s}
              statusOptions={sessionStatusOptions(s.status)}
            />
          ))}
          {exp.sessions.length === 0 && <p className="py-6 text-center text-sm text-stone-500">Chưa có buổi nào.</p>}
        </div>
      </section>
    </div>
  );
}
