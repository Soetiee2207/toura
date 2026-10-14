import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/audit";
import { createBooking } from "@/lib/booking";
import { createExperience, createSession, updateExperience, updateSession } from "@/lib/catalog-admin";
import { experienceSchema, slugify } from "@/lib/catalog-schema";
import { prisma } from "@/lib/prisma";
import { raceOnRow } from "./helpers";

let admin: Actor;

const experienceInput = (overrides: Record<string, string> = {}) =>
  experienceSchema.parse({
    title: "Làm gốm Bát Tràng",
    slug: "",
    description: "Tự tay nặn gốm cùng nghệ nhân.",
    meetingPoint: "Cổng làng gốm",
    durationMinutes: "180",
    defaultPrice: "450000",
    isPublished: "on",
    ...overrides,
  });

async function openSession(capacity: number) {
  const { id: experienceId } = await createExperience(admin, experienceInput({ slug: `s-${crypto.randomUUID()}` }));
  await createSession(admin, {
    experienceId,
    startsAt: new Date(Date.now() + 48 * 3600_000),
    capacity,
    price: 100_000,
    status: "OPEN",
  });
  return prisma.session.findFirstOrThrow({ where: { experienceId } });
}

const book = (sessionId: string, quantity: number) =>
  createBooking({
    idempotencyKey: crypto.randomUUID(),
    sessionId,
    quantity,
    contactName: "Khách Test",
    contactEmail: "test@example.com",
    contactPhone: "0901234567",
  });

const update = (s: { id: string; price: number; status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED" }, patch: object) =>
  updateSession(admin, { sessionId: s.id, capacity: 10, price: s.price, status: s.status, ...patch });

async function cleanDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.bookingStatusHistory.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.session.deleteMany();
  await prisma.experience.deleteMany();
}

beforeAll(async () => {
  await cleanDatabase();
  await prisma.user.deleteMany({ where: { email: { endsWith: "@catalog-test.local" } } });
  admin = await prisma.user.create({
    data: { email: "admin@catalog-test.local", name: "Admin", role: "ADMIN", passwordHash: "-" },
    select: { id: true, role: true },
  });
});
beforeEach(cleanDatabase);
afterAll(async () => {
  await cleanDatabase();
  await prisma.user.deleteMany({ where: { email: { endsWith: "@catalog-test.local" } } });
  await prisma.$disconnect();
});

describe("trải nghiệm", () => {
  it("slugify bỏ dấu tiếng Việt", () => {
    expect(slugify("Tour Ẩm thực Phố cổ Đông Hà!")).toBe("tour-am-thuc-pho-co-dong-ha");
  });

  it("tạo mới: slug để trống → tự sinh từ tên, ghi audit log", async () => {
    const { id } = await createExperience(admin, experienceInput());

    const exp = await prisma.experience.findUniqueOrThrow({ where: { id } });
    expect(exp.slug).toBe("lam-gom-bat-trang");
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "experience.create" } })).toBe(1);
  });

  it("slug trùng → SLUG_TAKEN (gắn vào ô slug), không tạo bản ghi thứ hai", async () => {
    await createExperience(admin, experienceInput());
    await expect(createExperience(admin, experienceInput())).rejects.toMatchObject({ code: "SLUG_TAKEN", field: "slug" });
    expect(await prisma.experience.count()).toBe(1);
  });

  it("sửa: audit log chỉ ghi các trường THỰC SỰ đổi; không đổi gì thì không ghi", async () => {
    const { id } = await createExperience(admin, experienceInput());

    await updateExperience(admin, id, experienceInput({ defaultPrice: "500000", isPublished: "off" }));
    await updateExperience(admin, id, experienceInput({ defaultPrice: "500000", isPublished: "off" })); // y hệt

    const logs = await prisma.auditLog.findMany({ where: { entityId: id, action: "experience.update" } });
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata).toEqual({
      changes: { defaultPrice: { from: 450000, to: 500000 }, isPublished: { from: true, to: false } },
    });
  });
});

describe("buổi", () => {
  it("không tạo được buổi trong quá khứ", async () => {
    const { id } = await createExperience(admin, experienceInput());
    await expect(
      createSession(admin, { experienceId: id, startsAt: new Date(Date.now() - 1000), capacity: 5, price: 0, status: "OPEN" }),
    ).rejects.toMatchObject({ code: "STARTS_IN_PAST" });
  });

  it("giảm sức chứa: được xuống ĐÚNG bằng số chỗ đã giữ, không được thấp hơn", async () => {
    const s = await openSession(10);
    await book(s.id, 4);

    await expect(update(s, { capacity: 3 })).rejects.toMatchObject({ code: "CAPACITY_BELOW_BOOKED", field: "capacity" });
    await update(s, { capacity: 4 });

    expect(await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ capacity: 4, seatsBooked: 4 });
  });

  it("đổi giá chỉ áp dụng cho đơn MỚI (đơn cũ đã snapshot)", async () => {
    const s = await openSession(10);
    const { code } = await book(s.id, 1);

    await update(s, { price: 150_000 });
    const { code: code2 } = await book(s.id, 1);

    expect((await prisma.booking.findUniqueOrThrow({ where: { code } })).unitPrice).toBe(100_000);
    expect((await prisma.booking.findUniqueOrThrow({ where: { code: code2 } })).unitPrice).toBe(150_000);
  });

  it("máy trạng thái: OPEN → DRAFT bị cấm; CLOSED ⇄ OPEN được", async () => {
    const s = await openSession(10);
    await expect(update(s, { status: "DRAFT" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await update(s, { status: "CLOSED" });
    await update({ ...s, status: "CLOSED" }, { status: "OPEN" });
  });

  it("huỷ buổi khi còn chỗ đang giữ → HAS_BOOKINGS; hết đơn thì huỷ được, sau đó không sửa được nữa", async () => {
    const s = await openSession(10);
    await book(s.id, 2);

    await expect(update(s, { status: "CANCELLED" })).rejects.toMatchObject({ code: "HAS_BOOKINGS" });

    await prisma.session.update({ where: { id: s.id }, data: { seatsBooked: 0 } }); // giả lập: đã huỷ hết đơn
    await update(s, { status: "CANCELLED" });
    expect(await prisma.auditLog.count({ where: { entityId: s.id, action: "session.cancel" } })).toBe(1);

    await expect(update({ ...s, status: "CANCELLED" }, { status: "CANCELLED", price: 1 })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  // Buổi 10 chỗ, đã giữ 4. Admin giảm xuống 5; cùng lúc khách đặt thêm 3 (4 + 3 = 7 > 5).
  // Chỉ một trong hai được phép thành công — bên nào vào hàng TRƯỚC thắng. Kiểm tra cả hai thứ tự.
  it.each([
    ["admin tới trước", "admin"],
    ["khách tới trước", "customer"],
  ] as const)("CẠNH TRANH: giảm sức chứa đúng lúc khách đặt (%s) → bên kia thua êm, không bán vượt", async (_l, first) => {
    const s = await openSession(10);
    await book(s.id, 4);

    const shrink = () => update(s, { capacity: 5 });
    const bookThree = () => book(s.id, 3);
    const [winner, loser] = await raceOnRow(
      "sessions",
      s.id,
      first === "admin" ? [shrink, bookThree] : [bookThree, shrink],
      { ordered: true },
    );

    expect(winner.status).toBe("fulfilled");
    expect(loser.status).toBe("rejected");
    // Bên thua nhận lỗi NGHIỆP VỤ dễ hiểu, không phải lỗi CHECK constraint của DB
    expect((loser as PromiseRejectedResult).reason.code).toBe(first === "admin" ? "NOT_ENOUGH_SEATS" : "CAPACITY_BELOW_BOOKED");

    const after = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(after).toMatchObject(first === "admin" ? { capacity: 5, seatsBooked: 4 } : { capacity: 10, seatsBooked: 7 });
  });
});
