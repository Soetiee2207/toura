import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BookingError, createBooking } from "@/lib/booking";
import { prisma } from "@/lib/prisma";

const contact = { contactName: "Khách Test", contactEmail: "test@example.com", contactPhone: "0901234567" };

// Mỗi test tự tạo dữ liệu riêng: 1 experience + 1 session với số chỗ cho trước
async function createSession(opts: { capacity: number; price?: number; startsInHours?: number; status?: "OPEN" | "CLOSED"; published?: boolean }) {
  const exp = await prisma.experience.create({
    data: {
      slug: `test-${crypto.randomUUID()}`,
      title: "Tour test",
      description: "-",
      meetingPoint: "-",
      durationMinutes: 60,
      defaultPrice: opts.price ?? 100_000,
      isPublished: opts.published ?? true,
    },
  });
  return prisma.session.create({
    data: {
      experienceId: exp.id,
      startsAt: new Date(Date.now() + (opts.startsInHours ?? 48) * 3600_000),
      capacity: opts.capacity,
      price: opts.price ?? 100_000,
      status: opts.status ?? "OPEN",
    },
  });
}

async function cleanDatabase() {
  // Xoá theo thứ tự con → cha (vì khoá ngoại onDelete: Restrict)
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

describe("createBooking — luồng cơ bản", () => {
  it("tạo đơn PENDING, giữ chỗ, snapshot giá và ghi lịch sử", async () => {
    const session = await createSession({ capacity: 10, price: 350_000 });

    const { code } = await createBooking({ sessionId: session.id, quantity: 2, ...contact });

    expect(code).toMatch(/^TRA-[A-Z2-9]{6}$/);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { code }, include: { statusHistory: true } });
    expect(booking.status).toBe("PENDING");
    expect(booking.unitPrice).toBe(350_000);
    expect(booking.totalAmount).toBe(700_000);
    expect(booking.statusHistory).toHaveLength(1);
    expect(booking.statusHistory[0].toStatus).toBe("PENDING");

    const after = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.seatsBooked).toBe(2);
  });

  it("giá đổi sau khi đặt KHÔNG làm thay đổi đơn cũ (snapshot)", async () => {
    const session = await createSession({ capacity: 10, price: 350_000 });
    const { code } = await createBooking({ sessionId: session.id, quantity: 1, ...contact });

    await prisma.session.update({ where: { id: session.id }, data: { price: 400_000 } });

    const booking = await prisma.booking.findUniqueOrThrow({ where: { code } });
    expect(booking.totalAmount).toBe(350_000);
  });

  it("từ chối khi không đủ chỗ, và KHÔNG trừ chỗ", async () => {
    const session = await createSession({ capacity: 3 });

    await expect(createBooking({ sessionId: session.id, quantity: 4, ...contact })).rejects.toMatchObject({
      code: "NOT_ENOUGH_SEATS",
    });
    const after = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.seatsBooked).toBe(0);
  });

  it.each([
    ["buổi đang tạm ngừng bán", { status: "CLOSED" as const }],
    ["tour chưa công khai", { published: false }],
    ["buổi đã diễn ra", { startsInHours: -1 }],
  ])("từ chối khi %s", async (_label, opts) => {
    const session = await createSession({ capacity: 10, ...opts });

    const err = await createBooking({ sessionId: session.id, quantity: 1, ...contact }).catch((e) => e);
    expect(err).toBeInstanceOf(BookingError);
    expect(err.code).toBe("SESSION_NOT_AVAILABLE");
    expect(await prisma.booking.count()).toBe(0);
  });
});

describe("createBooking — CẠNH TRANH CHỖ (tiêu chí hoàn thành của đề bài)", () => {
  it("20 khách cùng đặt 1 vé vào buổi chỉ có 5 chỗ → đúng 5 đơn thành công, không bán vượt", async () => {
    const session = await createSession({ capacity: 5 });

    // Bắn 20 yêu cầu CÙNG LÚC (Promise.allSettled: chờ tất cả xong, kể cả cái bị lỗi)
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => createBooking({ sessionId: session.id, quantity: 1, ...contact })),
    );

    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(ok).toHaveLength(5);
    expect(failed).toHaveLength(15);
    // Những người thất bại phải nhận lỗi "hết chỗ" thân thiện, không phải lỗi hệ thống
    for (const f of failed) expect(f.reason).toMatchObject({ code: "NOT_ENOUGH_SEATS" });

    const after = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.seatsBooked).toBe(5);
    expect(await prisma.booking.count({ where: { sessionId: session.id } })).toBe(5);
  });

  it("đặt nhiều vé cùng lúc với số lượng khác nhau → tổng vé bán ra không bao giờ vượt sức chứa", async () => {
    const session = await createSession({ capacity: 10 });
    const quantities = [3, 4, 2, 5, 1, 3, 2, 4, 1, 2]; // tổng 27, chỉ có 10 chỗ

    await Promise.allSettled(
      quantities.map((quantity) => createBooking({ sessionId: session.id, quantity, ...contact })),
    );

    const after = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    const sold = await prisma.booking.aggregate({ where: { sessionId: session.id }, _sum: { quantity: true } });

    expect(after.seatsBooked).toBeLessThanOrEqual(10);
    // seats_booked phải KHỚP với tổng vé trong bảng bookings (không lệch "hai nguồn sự thật")
    expect(sold._sum.quantity ?? 0).toBe(after.seatsBooked);
  });
});
