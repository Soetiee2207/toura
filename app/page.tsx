import Link from "next/link";
import { Suspense } from "react";
import { getPublishedExperiences, type ExperienceCard } from "@/lib/catalog";
import { formatDateTimeVN, formatDuration, formatVND } from "@/lib/format";

// Trang chủ "/". Đây là Server Component (mặc định): chạy trên server, trình duyệt chỉ nhận HTML.
// Phần tĩnh (tiêu đề) được dựng sẵn; phần danh sách đọc DB nên "stream" vào sau, bọc trong <Suspense>.
export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Khám phá trải nghiệm địa phương</h1>
        <p className="mt-2 text-stone-600">
          Tour ngắn và workshop trong ngày, đặt chỗ nhanh, giá cố định mỗi người.
        </p>
      </section>

      <Suspense fallback={<ExperienceGridSkeleton />}>
        <ExperienceGrid />
      </Suspense>
    </div>
  );
}

async function ExperienceGrid() {
  const experiences = await getPublishedExperiences();

  if (experiences.length === 0) {
    return <p className="text-stone-500">Hiện chưa có trải nghiệm nào. Bạn quay lại sau nhé!</p>;
  }

  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {experiences.map((exp) => (
        <li key={exp.slug}>
          <ExperienceCardView exp={exp} />
        </li>
      ))}
    </ul>
  );
}

function ExperienceCardView({ exp }: { exp: ExperienceCard }) {
  const { nextSession } = exp;

  return (
    <Link
      href={`/experiences/${exp.slug}`}
      className="flex h-full flex-col rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
    >
      <h2 className="text-lg font-semibold leading-snug">{exp.title}</h2>

      <dl className="mt-3 space-y-1 text-sm text-stone-600">
        <div className="flex gap-2">
          <dt className="sr-only">Điểm hẹn</dt>
          <dd>📍 {exp.meetingPoint}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="sr-only">Thời lượng</dt>
          <dd>⏱ {formatDuration(exp.durationMinutes)}</dd>
        </div>
      </dl>

      <div className="mt-auto pt-4">
        {nextSession ? (
          <p className="text-sm text-stone-600">
            Buổi gần nhất: <span className="font-medium text-stone-900">{formatDateTimeVN(nextSession.startsAt)}</span>
            {nextSession.seatsLeft <= 3 && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                Còn {nextSession.seatsLeft} chỗ
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-stone-500">Chưa có lịch mở bán</p>
        )}
        <p className="mt-2 text-base">
          <span className="text-stone-500">Từ </span>
          <span className="font-bold text-emerald-700">{formatVND(exp.fromPrice)}</span>
          <span className="text-stone-500"> / người</span>
        </p>
      </div>
    </Link>
  );
}

function ExperienceGridSkeleton() {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Đang tải">
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i} className="h-52 animate-pulse rounded-xl border border-stone-200 bg-white" />
      ))}
    </ul>
  );
}
