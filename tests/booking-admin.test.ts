import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "@/lib/booking";
import { type Actor, cancelBooking, confirmBooking, expireOverdueBookings } from "@/lib/booking-admin";
import { prisma } from "@/lib/prisma";
import { raceOnRow } from "./helpers";

let staff: Actor;
let admin: Actor;

// Tạo 1 buổi + 1 đơn PENDING giữ `quantity` chỗ (đi qua đúng createBooking như khách thật)
async function setup(quantity = 2) {
  const exp = await prisma.experience.create({
    data: {
      slug: `test-${crypto.randomUUID()}`,
      title: "Tour test",
      description: "-",
      meetingPoint: "-",
      durationMinutes: 60,
      defaultPrice: 100_000,
      isPublished: true,
    },
  });
  const session = await prisma.session.create({
    data: { experienceId: exp.id, startsAt: new Date(Date.now() + 48 * 3600_000), capacity: 10, price: 100_000, status: "OPEN" },
  });
  const { code } = await createBooking({
    idempotencyKey: crypto.randomUUID(),
    sessionId: session.id,
    quantity,
    contactName: "Khách Test",
    contactEmail: "test@example.com",
    contactPhone: "0901234567",
  });
  const booking = await prisma.booking.findUniqueOrThrow({ where: { code } });
  return { booking, sessionId: session.id };
}

const seatsBooked = async (sessionId: string) =>
  (await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).seatsBooked;

async function cleanDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.bookingStatusHistory.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.session.deleteMany();
  await prisma.experience.deleteMany();
}

beforeAll(async () => {
  await cleanDatabase();
  await prisma.user.deleteMany({ where: { email: { endsWith: "@admin-test.local" } } });
  const mk = (email: string, role: "STAFF" | "ADMIN") =>
    prisma.user.create({ data: { email, name: role, role, passwordHash: "-" }, select: { id: true, role: true } });
  staff = await mk("staff@admin-test.local", "STAFF");
  admin = await mk("admin@admin-test.local", "ADMIN");
});
beforeEach(cleanDatabase);
afterAll(async () => {
  await cleanDatabase();
  await prisma.user.deleteMany({ where: { email: { endsWith: "@admin-test.local" } } });
  await prisma.$disconnect();
});

describe("xác nhận đơn", () => {
  it("PENDING → CONFIRMED, ghi lịch sử (ai làm) + audit log, KHÔNG đổi số chỗ", async () => {
    const { booking, sessionId } = await setup(2);

    await confirmBooking(booking.id, staff);

    const after = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { statusHistory: { orderBy: { createdAt: "asc" } } },
    });
    expect(after.status).toBe("CONFIRMED");
    expect(after.statusHistory.at(-1)).toMatchObject({
      fromStatus: "PENDING",
      toStatus: "CONFIRMED",
      actorType: "STAFF",
      actorUserId: staff.id,
    });
    const logs = await prisma.auditLog.findMany({ where: { entityId: booking.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "booking.confirm", actorUserId: staff.id });
    expect(await seatsBooked(sessionId)).toBe(2);
  });

  it("xác nhận lần 2 → INVALID_TRANSITION (CONFIRMED không sang CONFIRMED được)", async () => {
    const { booking } = await setup();
    await confirmBooking(booking.id, staff);
    await expect(confirmBooking(booking.id, staff)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("đơn đã quá hạn giữ chỗ → HOLD_EXPIRED, đơn giữ nguyên PENDING", async () => {
    const { booking } = await setup();
    await prisma.booking.update({ where: { id: booking.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await expect(confirmBooking(booking.id, staff)).rejects.toMatchObject({ code: "HOLD_EXPIRED" });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("PENDING");
  });

  it("đơn không tồn tại → NOT_FOUND", async () => {
    await expect(confirmBooking(crypto.randomUUID(), staff)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("huỷ đơn", () => {
  it("huỷ PENDING → CANCELLED, lưu lý do + người huỷ, TRẢ LẠI CHỖ", async () => {
    const { booking, sessionId } = await setup(3);
    expect(await seatsBooked(sessionId)).toBe(3);

    await cancelBooking(booking.id, staff, "Khách gọi điện xin huỷ");

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after).toMatchObject({ status: "CANCELLED", cancelledBy: "STAFF", cancelledReason: "Khách gọi điện xin huỷ" });
    expect(after.cancelledAt).toBeInstanceOf(Date);
    expect(await seatsBooked(sessionId)).toBe(0);
  });

  it("STAFF huỷ đơn ĐÃ XÁC NHẬN → FORBIDDEN, không đổi gì; ADMIN thì được", async () => {
    const { booking, sessionId } = await setup(2);
    await confirmBooking(booking.id, staff);

    await expect(cancelBooking(booking.id, staff, "thử")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await seatsBooked(sessionId)).toBe(2);

    await cancelBooking(booking.id, admin, "Thời tiết xấu");
    expect(await seatsBooked(sessionId)).toBe(0);
  });

  it("đơn đã huỷ không thể xác nhận lại hay huỷ lần nữa", async () => {
    const { booking } = await setup();
    await cancelBooking(booking.id, staff, "lý do");

    await expect(confirmBooking(booking.id, admin)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(cancelBooking(booking.id, admin, "lần 2")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("CẠNH TRANH: nhiều nhân viên thao tác cùng một đơn cùng lúc", () => {
  it("5 người cùng bấm Huỷ → đúng 1 thành công, chỗ chỉ được trả MỘT lần", async () => {
    const { booking, sessionId } = await setup(2);
    // Buổi có đơn khác giữ 2 chỗ nữa → nếu trả chỗ 2 lần, seats_booked sẽ sai (2 - 2 - 2 ... )
    await prisma.session.update({ where: { id: sessionId }, data: { seatsBooked: { increment: 2 } } });

    const results = await raceOnRow(
      "bookings",
      booking.id,
      Array.from({ length: 5 }, () => () => cancelBooking(booking.id, admin, "huỷ đồng thời")),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await seatsBooked(sessionId)).toBe(2); // 4 - 2 (trả đúng 1 lần)
    const history = await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id, toStatus: "CANCELLED" } });
    expect(history).toBe(1);
  });

  it("một người Xác nhận, một người Huỷ cùng lúc → chỉ một bên thắng, dữ liệu nhất quán", async () => {
    const { booking, sessionId } = await setup(2);

    const results = await raceOnRow("bookings", booking.id, [
      () => confirmBooking(booking.id, staff),
      () => cancelBooking(booking.id, staff, "huỷ"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const history = await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id } });
    expect(history).toBe(2); // PENDING (lúc tạo) + đúng 1 thay đổi
    // Thắng là xác nhận → chỗ vẫn giữ; thắng là huỷ → chỗ được trả
    expect(await seatsBooked(sessionId)).toBe(after.status === "CONFIRMED" ? 2 : 0);
  });
});

describe("job hết hạn giữ chỗ (expireOverdueBookings)", () => {
  const makeOverdue = (id: string) =>
    prisma.booking.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 60_000) } });

  it("đơn PENDING quá hạn → EXPIRED, trả chỗ, lịch sử ghi SYSTEM + audit log", async () => {
    const { booking, sessionId } = await setup(3);
    await makeOverdue(booking.id);

    expect(await expireOverdueBookings()).toEqual({ scanned: 1, expired: 1 });

    const after = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { statusHistory: { orderBy: { createdAt: "asc" } } },
    });
    expect(after.status).toBe("EXPIRED");
    expect(after.statusHistory.at(-1)).toMatchObject({ fromStatus: "PENDING", toStatus: "EXPIRED", actorType: "SYSTEM", actorUserId: null });
    expect(await prisma.auditLog.count({ where: { entityId: booking.id, action: "booking.expire", actorType: "SYSTEM" } })).toBe(1);
    expect(await seatsBooked(sessionId)).toBe(0);
  });

  it("KHÔNG đụng tới: đơn còn hạn, đơn đã xác nhận, đơn đã huỷ", async () => {
    const stillValid = await setup(1);
    const confirmed = await setup(1);
    await confirmBooking(confirmed.booking.id, staff);
    await makeOverdue(confirmed.booking.id); // đã xác nhận rồi thì hạn giữ chỗ không còn ý nghĩa
    const cancelled = await setup(1);
    await cancelBooking(cancelled.booking.id, staff, "lý do");
    await makeOverdue(cancelled.booking.id);

    expect(await expireOverdueBookings()).toEqual({ scanned: 0, expired: 0 });

    const statuses = await prisma.booking.findMany({ select: { id: true, status: true } });
    const statusOf = (id: string) => statuses.find((b) => b.id === id)?.status;
    expect(statusOf(stillValid.booking.id)).toBe("PENDING");
    expect(statusOf(confirmed.booking.id)).toBe("CONFIRMED");
    expect(statusOf(cancelled.booking.id)).toBe("CANCELLED");
  });

  it("chạy lại lần 2 → không làm gì thêm, chỗ không bị trả 2 lần", async () => {
    const { booking, sessionId } = await setup(2);
    await prisma.session.update({ where: { id: sessionId }, data: { seatsBooked: { increment: 3 } } }); // đơn khác giữ 3
    await makeOverdue(booking.id);

    await expireOverdueBookings();
    expect(await expireOverdueBookings()).toEqual({ scanned: 0, expired: 0 });
    expect(await seatsBooked(sessionId)).toBe(3);
  });

  it("2 job chạy CHỒNG NHAU → mỗi đơn hết hạn đúng 1 lần", async () => {
    const { booking, sessionId } = await setup(2);
    await prisma.session.update({ where: { id: sessionId }, data: { seatsBooked: { increment: 3 } } });
    await makeOverdue(booking.id);

    const results = await raceOnRow("bookings", booking.id, [() => expireOverdueBookings(), () => expireOverdueBookings()]);

    const total = results.reduce((n, r) => n + (r.status === "fulfilled" ? (r.value as { expired: number }).expired : 0), 0);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true); // bên thua bỏ qua êm, không văng lỗi
    expect(total).toBe(1);
    expect(await seatsBooked(sessionId)).toBe(3);
  });

  it("nhân viên xác nhận và job hết hạn chạy cùng lúc (đúng lúc hết hạn) → chỉ một bên thắng", async () => {
    const { booking, sessionId } = await setup(2);
    // Hạn giữ chỗ còn 300ms: nhân viên đọc thấy "còn hạn", nhưng câu UPDATE chạy khi đã quá hạn
    await prisma.booking.update({ where: { id: booking.id }, data: { expiresAt: new Date(Date.now() + 300) } });

    await raceOnRow("bookings", booking.id, [
      () => confirmBooking(booking.id, staff),
      async () => {
        await new Promise((r) => setTimeout(r, 400)); // chờ quá hạn rồi job mới quét
        return expireOverdueBookings();
      },
    ]);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(["CONFIRMED", "EXPIRED"]).toContain(after.status);
    expect(await seatsBooked(sessionId)).toBe(after.status === "CONFIRMED" ? 2 : 0);
    expect(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id } })).toBe(2);
  });
});
