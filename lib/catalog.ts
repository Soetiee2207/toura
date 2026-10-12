// Tầng nghiệp vụ: đọc danh mục trải nghiệm cho trang khách.
// Trang (app/) chỉ gọi hàm ở đây, không tự viết truy vấn → quy tắc "thế nào là buổi đặt được" nằm ở MỘT chỗ.
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";

export type ExperienceCard = {
  slug: string;
  title: string;
  meetingPoint: string;
  durationMinutes: number;
  fromPrice: number; // giá thấp nhất trong các buổi còn đặt được
  nextSession: { startsAt: Date; seatsLeft: number } | null;
};

// Điều kiện một buổi "còn đặt được": đang mở bán, chưa diễn ra, còn chỗ.
function bookableSessionWhere(now: Date) {
  return {
    status: "OPEN" as const,
    startsAt: { gt: now },
    // So sánh 2 cột với nhau (seats_booked < capacity) → dùng "field reference" của Prisma
    seatsBooked: { lt: prisma.session.fields.capacity },
  };
}

export async function getPublishedExperiences(): Promise<ExperienceCard[]> {
  // Kết quả phụ thuộc thời điểm hiện tại + số chỗ thay đổi liên tục
  // → báo Next.js: KHÔNG dựng sẵn trang này lúc build, chạy lại ở mỗi request.
  await connection();
  const now = new Date();

  const experiences = await prisma.experience.findMany({
    where: { isPublished: true },
    orderBy: { title: "asc" },
    select: {
      slug: true,
      title: true,
      meetingPoint: true,
      durationMinutes: true,
      defaultPrice: true,
      sessions: {
        where: bookableSessionWhere(now),
        orderBy: { startsAt: "asc" },
        select: { startsAt: true, capacity: true, seatsBooked: true, price: true },
      },
    },
  });

  return experiences.map(({ sessions, defaultPrice, ...exp }) => {
    const next = sessions[0];
    return {
      ...exp,
      fromPrice: sessions.length > 0 ? Math.min(...sessions.map((s) => s.price)) : defaultPrice,
      nextSession: next
        ? { startsAt: next.startsAt, seatsLeft: next.capacity - next.seatsBooked }
        : null,
    };
  });
}
