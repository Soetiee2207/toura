import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { BookingStatus, SessionStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { currentMonthVN, getMonthlyReport, monthRangeVN, shiftMonth } from "@/lib/reports";

const NOW = new Date("2026-10-14T05:00:00Z");

async function experience(title: string) {
  return prisma.experience.create({
    data: {
      slug: `r-${crypto.randomUUID()}`,
      title,
      description: "-",
      meetingPoint: "-",
      durationMinutes: 60,
      defaultPrice: 100_000,
      isPublished: true,
    },
  });
}

async function session(experienceId: string, startsAt: string, opts: { capacity?: number; status?: SessionStatus } = {}) {
  return prisma.session.create({
    data: { experienceId, startsAt: new Date(startsAt), capacity: opts.capacity ?? 10, price: 100_000, status: opts.status ?? "OPEN" },
  });
}

// Tạo thẳng đơn bằng prisma (báo cáo chỉ ĐỌC, không cần đi qua createBooking)
async function booking(sessionId: string, quantity: number, status: BookingStatus, expiresAt = new Date(NOW.getTime() + 3600_000)) {
  await prisma.booking.create({
    data: {
      code: `TRA-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      sessionId,
      contactName: "Khách",
      contactEmail: "k@example.com",
      contactPhone: "0901234567",
      quantity,
      unitPrice: 100_000,
      totalAmount: 100_000 * quantity,
      status,
      expiresAt,
    },
  });
}

async function cleanDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.bookingStatusHistory.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.session.deleteMany();
  await prisma.experience.deleteMany();
}

beforeEach(cleanDatabase);
afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("tháng theo giờ Việt Nam", () => {
  it("monthRangeVN: 00:00 ngày 1 giờ VN = 17:00 ngày cuối tháng trước (UTC)", () => {
    const { from, to } = monthRangeVN("2026-10");
    expect(from.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });

  it("shiftMonth qua năm", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("currentMonthVN: 18:00 UTC ngày 31/10 đã là tháng 11 ở Việt Nam", () => {
    expect(currentMonthVN(new Date("2026-10-31T18:00:00Z"))).toBe("2026-11");
  });
});

describe("báo cáo doanh thu", () => {
  it("chỉ tính đơn CONFIRMED; PENDING còn hạn là 'đang chờ'; huỷ/hết hạn bỏ qua", async () => {
    const e = await experience("Tour A");
    const s = await session(e.id, "2026-10-20T11:00:00Z");
    await booking(s.id, 2, "CONFIRMED");
    await booking(s.id, 1, "PENDING");
    await booking(s.id, 3, "PENDING", new Date(NOW.getTime() - 1)); // đã quá hạn, job chưa kịp dọn
    await booking(s.id, 4, "CANCELLED");
    await booking(s.id, 1, "EXPIRED");

    const { rows, totals } = await getMonthlyReport("2026-10", NOW);

    expect(rows).toEqual([
      { experienceId: e.id, title: "Tour A", sessions: 1, capacity: 10, guests: 2, revenue: 200_000, pendingAmount: 100_000 },
    ]);
    expect(totals.revenue).toBe(200_000);
  });

  it("ranh giới tháng tính theo giờ VN, không theo UTC", async () => {
    const e = await experience("Tour B");
    const lateOct = await session(e.id, "2026-10-31T16:30:00Z"); // 23:30 31/10 giờ VN → tháng 10
    const earlyNov = await session(e.id, "2026-10-31T17:30:00Z"); // 00:30 01/11 giờ VN → tháng 11
    await booking(lateOct.id, 1, "CONFIRMED");
    await booking(earlyNov.id, 5, "CONFIRMED");

    expect((await getMonthlyReport("2026-10", NOW)).totals).toMatchObject({ sessions: 1, guests: 1, revenue: 100_000 });
    expect((await getMonthlyReport("2026-11", NOW)).totals).toMatchObject({ sessions: 1, guests: 5, revenue: 500_000 });
  });

  it("buổi có nhiều đơn: sức chứa chỉ cộng MỘT lần; buổi không có đơn vẫn được đếm", async () => {
    const e = await experience("Tour C");
    const busy = await session(e.id, "2026-10-10T01:00:00Z", { capacity: 10 });
    await session(e.id, "2026-10-11T01:00:00Z", { capacity: 8 }); // chưa ai đặt
    await booking(busy.id, 1, "CONFIRMED");
    await booking(busy.id, 2, "CONFIRMED");
    await booking(busy.id, 3, "CONFIRMED");

    const { totals } = await getMonthlyReport("2026-10", NOW);
    expect(totals).toMatchObject({ sessions: 2, capacity: 18, guests: 6, revenue: 600_000 });
  });

  it("bỏ qua buổi đã huỷ; sắp xếp trải nghiệm theo doanh thu giảm dần", async () => {
    const small = await experience("Nhỏ");
    const big = await experience("Lớn");
    await booking((await session(small.id, "2026-10-05T01:00:00Z")).id, 1, "CONFIRMED");
    await booking((await session(big.id, "2026-10-06T01:00:00Z")).id, 4, "CONFIRMED");
    await session(big.id, "2026-10-07T01:00:00Z", { status: "CANCELLED" });

    const { rows } = await getMonthlyReport("2026-10", NOW);
    expect(rows.map((r) => [r.title, r.sessions])).toEqual([
      ["Lớn", 1],
      ["Nhỏ", 1],
    ]);
  });

  it("tổng vượt giới hạn int4 (2,1 tỷ) vẫn đúng", async () => {
    const e = await experience("Tour lớn");
    const s = await session(e.id, "2026-10-20T01:00:00Z", { capacity: 500 });
    // 3 đơn × 1 tỷ — mỗi đơn vẫn vừa int4, nhưng TỔNG thì không
    for (let i = 0; i < 3; i++) {
      await prisma.booking.create({
        data: {
          code: `TRA-BIG${i}`,
          sessionId: s.id,
          contactName: "VIP",
          contactEmail: "v@example.com",
          contactPhone: "0901234567",
          quantity: 100,
          unitPrice: 10_000_000,
          totalAmount: 1_000_000_000,
          status: "CONFIRMED",
          expiresAt: NOW,
        },
      });
    }

    expect((await getMonthlyReport("2026-10", NOW)).totals.revenue).toBe(3_000_000_000);
  });
});
