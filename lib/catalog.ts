// Tầng nghiệp vụ: đọc danh mục trải nghiệm cho trang khách.
// Trang (app/) chỉ gọi hàm ở đây, không tự viết truy vấn → quy tắc "thế nào là buổi đặt được" nằm ở MỘT chỗ.
import { connection } from "next/server";
import { formatDateTimeVN } from "@/lib/format";
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

export type BookableSession = {
  id: string;
  startsAtLabel: string; // đã định dạng sẵn trên server ("18:00 Thứ 3, 13/10")
  price: number;
  seatsLeft: number;
};

export type ExperienceDetail = {
  title: string;
  description: string;
  meetingPoint: string;
  durationMinutes: number;
  sessions: BookableSession[];
};

// Trả về null nếu không tìm thấy HOẶC chưa công khai → trang sẽ hiện 404.
// (Không để khách đoán URL mà xem được tour đang soạn nháp.)
export async function getExperienceDetail(slug: string): Promise<ExperienceDetail | null> {
  await connection();
  const now = new Date();

  const exp = await prisma.experience.findUnique({
    where: { slug },
    select: {
      title: true,
      description: true,
      meetingPoint: true,
      durationMinutes: true,
      isPublished: true,
      sessions: {
        where: bookableSessionWhere(now), // dùng lại đúng quy tắc của trang chủ
        orderBy: { startsAt: "asc" },
        take: 30,
        select: { id: true, startsAt: true, price: true, capacity: true, seatsBooked: true },
      },
    },
  });

  if (!exp || !exp.isPublished) return null;

  return {
    title: exp.title,
    description: exp.description,
    meetingPoint: exp.meetingPoint,
    durationMinutes: exp.durationMinutes,
    sessions: exp.sessions.map((s) => ({
      id: s.id,
      startsAtLabel: formatDateTimeVN(s.startsAt),
      price: s.price,
      seatsLeft: s.capacity - s.seatsBooked,
    })),
  };
}

export type SessionForBooking = {
  sessionId: string;
  experienceTitle: string;
  experienceSlug: string;
  meetingPoint: string;
  startsAtLabel: string;
  price: number;
  seatsLeft: number;
};

// Thông tin 1 buổi để hiển thị trên trang đặt chỗ. null nếu buổi không còn đặt được.
// Chỉ để HIỂN THỊ — lúc tạo đơn, lib/booking.ts sẽ kiểm tra lại mọi điều kiện trong transaction.
export async function getSessionForBooking(sessionId: string): Promise<SessionForBooking | null> {
  await connection();

  const session = await prisma.session.findFirst({
    where: { id: sessionId, ...bookableSessionWhere(new Date()), experience: { isPublished: true } },
    select: {
      id: true,
      startsAt: true,
      price: true,
      capacity: true,
      seatsBooked: true,
      experience: { select: { title: true, slug: true, meetingPoint: true } },
    },
  });
  if (!session) return null;

  return {
    sessionId: session.id,
    experienceTitle: session.experience.title,
    experienceSlug: session.experience.slug,
    meetingPoint: session.experience.meetingPoint,
    startsAtLabel: formatDateTimeVN(session.startsAt),
    price: session.price,
    seatsLeft: session.capacity - session.seatsBooked,
  };
}
