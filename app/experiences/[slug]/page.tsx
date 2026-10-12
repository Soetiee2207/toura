import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getExperienceDetail } from "@/lib/catalog";
import { formatDuration } from "@/lib/format";
import { SessionPicker } from "./session-picker";

// Trang chi tiết: /experiences/<slug>. Thư mục [slug] = phần URL là BIẾN.
// Server Component: đọc DB trên server, phần chọn buổi tương tác được giao cho <SessionPicker> (Client Component).
export default function ExperiencePage({ params }: PageProps<"/experiences/[slug]">) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/" className="text-sm text-stone-500 hover:text-emerald-700">
        ← Tất cả trải nghiệm
      </Link>

      {/* params là Promise (giá trị chỉ có khi có request) → đọc nó bên trong Suspense */}
      <Suspense fallback={<DetailSkeleton />}>
        <ExperienceDetailView params={params} />
      </Suspense>
    </div>
  );
}

async function ExperienceDetailView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const exp = await getExperienceDetail(slug);

  if (!exp) notFound(); // slug sai hoặc tour chưa công khai → trang 404

  return (
    <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_380px]">
      <article>
        <h1 className="text-3xl font-bold tracking-tight">{exp.title}</h1>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-stone-600">
          <li>📍 {exp.meetingPoint}</li>
          <li>⏱ {formatDuration(exp.durationMinutes)}</li>
        </ul>
        <p className="mt-6 leading-7 whitespace-pre-line text-stone-700">{exp.description}</p>
      </article>

      <aside className="h-fit rounded-xl border border-stone-200 bg-white p-5 shadow-sm lg:sticky lg:top-6">
        <h2 className="text-lg font-semibold">Chọn buổi</h2>
        {exp.sessions.length > 0 ? (
          <SessionPicker sessions={exp.sessions} />
        ) : (
          <p className="mt-3 text-sm text-stone-500">Hiện chưa có buổi nào mở bán.</p>
        )}
      </aside>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mt-4 grid animate-pulse gap-8 lg:grid-cols-[1fr_380px]" aria-busy="true">
      <div className="space-y-4">
        <div className="h-9 w-2/3 rounded bg-stone-200" />
        <div className="h-4 w-1/2 rounded bg-stone-200" />
        <div className="h-32 rounded bg-stone-200" />
      </div>
      <div className="h-80 rounded-xl bg-stone-200" />
    </div>
  );
}
