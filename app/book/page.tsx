import Link from "next/link";
import { Suspense } from "react";
import { getSessionForBooking } from "@/lib/catalog";
import { formatVND } from "@/lib/format";
import { BookingForm } from "./booking-form";

// Trang đặt chỗ: /book?session=<id>&qty=<n>
// Tham số trên URL (searchParams) chỉ là GỢI Ý từ trang trước — khách có thể sửa tuỳ ý → kiểm tra lại hết.
export default function BookPage({ searchParams }: PageProps<"/book">) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Đặt chỗ</h1>
      <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-xl bg-stone-200" />}>
        <BookContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function BookContent({ searchParams }: { searchParams: PageProps<"/book">["searchParams"] }) {
  const params = await searchParams;
  const sessionId = typeof params.session === "string" ? params.session : "";
  const qty = Number(params.qty) || 1;

  // UUID sai định dạng → khỏi hỏi DB (Postgres sẽ báo lỗi kiểu dữ liệu)
  const isUuid = /^[0-9a-f-]{36}$/i.test(sessionId);
  const session = isUuid ? await getSessionForBooking(sessionId) : null;

  if (!session) {
    return (
      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-6">
        <p>Buổi bạn chọn không còn mở bán hoặc đã hết chỗ.</p>
        <Link href="/" className="mt-3 inline-block font-medium text-emerald-700 hover:underline">
          ← Chọn trải nghiệm khác
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-[1fr_1.2fr]">
      <section className="h-fit rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="font-semibold">{session.experienceTitle}</h2>
        <dl className="mt-3 space-y-1 text-sm text-stone-600">
          <div>🗓 {session.startsAtLabel}</div>
          <div>📍 {session.meetingPoint}</div>
          <div>💵 {formatVND(session.price)} / người</div>
          <div>👥 Còn {session.seatsLeft} chỗ</div>
        </dl>
        <Link
          href={`/experiences/${session.experienceSlug}`}
          className="mt-4 inline-block text-sm text-stone-500 hover:text-emerald-700"
        >
          ← Đổi buổi khác
        </Link>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <BookingForm
          sessionId={session.sessionId}
          price={session.price}
          seatsLeft={session.seatsLeft}
          initialQuantity={qty}
        />
      </section>
    </div>
  );
}
