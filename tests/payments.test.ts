import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/sepay/route";
import { createBooking } from "@/lib/booking";
import { type Actor, cancelBooking, expireOverdueBookings } from "@/lib/booking-admin";
import { processSepayTransfer } from "@/lib/payments";
import { prisma } from "@/lib/prisma";
import { extractBookingCode, type SepayTransfer, signSepayBody, transferContentFor, verifySepaySignature } from "@/lib/sepay";
import { raceOnRow } from "./helpers";

// Giả lập lỗi TẠM THỜI giữa chừng (vd: DB rớt kết nối) ở bước ghi lịch sử — SAU khi đã ghi sự kiện + tiền.
const failures = vi.hoisted(() => ({ next: false }));
vi.mock("@/lib/booking-history", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/booking-history")>();
  return {
    ...mod,
    recordTransition: async (...args: Parameters<typeof mod.recordTransition>) => {
      if (failures.next) {
        failures.next = false;
        throw new Error("DB tạm mất kết nối");
      }
      return mod.recordTransition(...args);
    },
  };
});

const SECRET = "test-sepay-secret";
const PRICE = 100_000;
let admin: Actor;
let txnSeq = 1;

async function setup({ quantity = 2, capacity = 10 } = {}) {
  const exp = await prisma.experience.create({
    data: {
      slug: `pay-${crypto.randomUUID()}`,
      title: "Tour test",
      description: "-",
      meetingPoint: "-",
      durationMinutes: 60,
      defaultPrice: PRICE,
      isPublished: true,
    },
  });
  const session = await prisma.session.create({
    data: { experienceId: exp.id, startsAt: new Date(Date.now() + 48 * 3600_000), capacity, price: PRICE, status: "OPEN" },
  });
  const { code } = await createBooking({
    idempotencyKey: crypto.randomUUID(),
    sessionId: session.id,
    quantity,
    contactName: "Khách Test",
    contactEmail: "test@example.com",
    contactPhone: "0901234567",
  });
  return { code, sessionId: session.id, total: PRICE * quantity };
}

// Một giao dịch tiền VÀO như SePay gửi; mỗi lần gọi là một giao dịch mới (id khác nhau)
const transfer = (content: string, amount: number, extra: Partial<SepayTransfer> = {}): SepayTransfer => ({
  id: txnSeq++,
  gateway: "Vietcombank",
  transactionDate: "2026-10-20 10:00:00",
  accountNumber: "0123456789",
  code: null,
  content,
  transferType: "in",
  transferAmount: amount,
  referenceCode: "FT000",
  ...extra,
});

const bookingOf = (code: string) =>
  prisma.booking.findUniqueOrThrow({
    where: { code },
    include: { payments: { orderBy: { createdAt: "asc" } }, statusHistory: { orderBy: { createdAt: "asc" } } },
  });
const seatsOf = async (sessionId: string) => (await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).seatsBooked;

// Cho đơn hết hạn bằng ĐÚNG job thật (trả chỗ, đánh dấu hoàn tiền...)
async function expire(code: string) {
  await prisma.booking.update({ where: { code }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await expireOverdueBookings();
}

async function cleanDatabase() {
  await prisma.webhookEvent.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.bookingStatusHistory.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.session.deleteMany();
  await prisma.experience.deleteMany();
}

beforeAll(async () => {
  process.env.SEPAY_WEBHOOK_SECRET = SECRET;
  await cleanDatabase();
  await prisma.user.deleteMany({ where: { email: { endsWith: "@pay-test.local" } } });
  admin = await prisma.user.create({
    data: { email: "admin@pay-test.local", name: "Admin", role: "ADMIN", passwordHash: "-" },
    select: { id: true, role: true },
  });
});
beforeEach(cleanDatabase);
afterAll(async () => {
  await cleanDatabase();
  await prisma.user.deleteMany({ where: { email: { endsWith: "@pay-test.local" } } });
  await prisma.$disconnect();
});

describe("chữ ký SePay", () => {
  const body = '{"id":1,"transferAmount":100000}';
  const now = new Date("2026-10-20T03:00:00Z");
  const ts = Math.floor(now.getTime() / 1000);
  const check = (over: Partial<Parameters<typeof verifySepaySignature>[0]>) =>
    verifySepaySignature({ secret: SECRET, rawBody: body, signature: signSepayBody(SECRET, ts, body), timestamp: String(ts), now, ...over });

  it("đúng secret, đúng body, đúng giờ → hợp lệ", () => expect(check({})).toBe(true));
  it("ký bằng secret khác → từ chối", () => expect(check({ signature: signSepayBody("doan-mo", ts, body) })).toBe(false));
  it("sửa body (đổi số tiền) → từ chối", () => expect(check({ rawBody: body.replace("100000", "999999") })).toBe(false));
  it("cùng nội dung nhưng khác khoảng trắng → từ chối (phải dùng body NGUYÊN VĂN)", () =>
    expect(check({ rawBody: '{"id": 1, "transferAmount": 100000}' })).toBe(false));
  it("request cũ hơn 5 phút gửi lại → từ chối", () =>
    expect(check({ now: new Date(now.getTime() + 301_000) })).toBe(false));
  it("thiếu header / header rác → từ chối, không văng lỗi", () => {
    expect(check({ signature: null })).toBe(false);
    expect(check({ timestamp: "abc" })).toBe(false);
    expect(check({ signature: "sha256=ngan" })).toBe(false);
  });
});

describe("tìm mã đơn trong nội dung chuyển khoản", () => {
  it.each([
    ["TRA7X3K9A chuyen tien", "TRA-7X3K9A"],
    ["MBVCB.1234.tra 7x3k9a.CT tu 0123", "TRA-7X3K9A"],
    ["Thanh toan TRA-7X3K9A", "TRA-7X3K9A"],
    ["chuyen tien an trua", null],
    ["TRA7X3K9AB", null], // dài hơn 6 ký tự → không phải mã đơn
    ["TRA7X3K0A", null], // có số 0 — không có trong bảng chữ mã đơn
  ])("%s → %s", (content, expected) => expect(extractBookingCode(content)).toBe(expected));

  it("nội dung hiển thị cho khách bỏ dấu gạch", () => expect(transferContentFor("TRA-7X3K9A")).toBe("TRA7X3K9A"));
});

describe("tiền về cho đơn đang giữ chỗ", () => {
  it("đủ tiền → CONFIRMED, ghi Payment, lịch sử do SYSTEM, lưu webhook kèm kết quả", async () => {
    const { code, total } = await setup();
    const t = transfer(`${transferContentFor(code)} chuyen tien`, total);

    expect(await processSepayTransfer(t)).toEqual({ outcome: "CONFIRMED", bookingCode: code });

    const b = await bookingOf(code);
    expect(b.status).toBe("CONFIRMED");
    expect(b.payments).toMatchObject([{ status: "SUCCEEDED", amount: total, providerTxnId: String(t.id), refundAmount: null }]);
    expect(b.statusHistory.at(-1)).toMatchObject({ fromStatus: "PENDING", toStatus: "CONFIRMED", actorType: "SYSTEM" });
    expect(await prisma.webhookEvent.findFirst()).toMatchObject({ providerEventId: String(t.id), outcome: "CONFIRMED" });
  });

  it("SePay gửi lại CÙNG webhook → DUPLICATE, không ghi tiền lần hai", async () => {
    const { code, total } = await setup();
    const t = transfer(transferContentFor(code), total);

    await processSepayTransfer(t);
    expect(await processSepayTransfer(t)).toEqual({ outcome: "DUPLICATE" });
    expect((await bookingOf(code)).payments).toHaveLength(1);
  });

  it("CÙNG webhook tới đồng thời 5 lần → đúng 1 lần xử lý", async () => {
    const { code, total } = await setup();
    const t = transfer(transferContentFor(code), total);

    const results = await Promise.all(Array.from({ length: 5 }, () => processSepayTransfer(t)));

    expect(results.filter((r) => r.outcome === "CONFIRMED")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "DUPLICATE")).toHaveLength(4);
    expect((await bookingOf(code)).payments).toHaveLength(1);
  });

  it("lỗi giữa chừng → rollback TẤT CẢ (cả sự kiện); SePay gửi lại → xử lý bình thường, không bị coi là trùng", async () => {
    const { code, total } = await setup();
    const t = transfer(transferContentFor(code), total);

    failures.next = true;
    await expect(processSepayTransfer(t)).rejects.toThrow("DB tạm mất kết nối");
    expect(await prisma.webhookEvent.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);

    expect(await processSepayTransfer(t)).toEqual({ outcome: "CONFIRMED", bookingCode: code });
  });

  it("chuyển THIẾU → PARTIAL, đơn vẫn PENDING; chuyển BÙ đủ → CONFIRMED", async () => {
    const { code, total } = await setup();

    expect((await processSepayTransfer(transfer(transferContentFor(code), 50_000))).outcome).toBe("PARTIAL");
    expect((await bookingOf(code)).status).toBe("PENDING");

    expect((await processSepayTransfer(transfer(transferContentFor(code), total - 50_000))).outcome).toBe("CONFIRMED");
    expect((await bookingOf(code)).status).toBe("CONFIRMED");
  });

  it("chuyển THỪA → vẫn CONFIRMED, phần thừa chờ hoàn", async () => {
    const { code, total } = await setup();
    await processSepayTransfer(transfer(transferContentFor(code), total + 30_000));

    const b = await bookingOf(code);
    expect(b.status).toBe("CONFIRMED");
    expect(b.payments[0]).toMatchObject({ status: "REFUND_PENDING", refundAmount: 30_000, refundReason: "Khách chuyển thừa" });
  });

  it("chuyển thiếu rồi HẾT HẠN → job trả chỗ và đánh dấu khoản đã chuyển chờ hoàn", async () => {
    const { code, sessionId } = await setup();
    await processSepayTransfer(transfer(transferContentFor(code), 50_000));

    await expire(code);

    const b = await bookingOf(code);
    expect(b.status).toBe("EXPIRED");
    expect(b.payments[0]).toMatchObject({ status: "REFUND_PENDING", refundAmount: 50_000 });
    expect(await seatsOf(sessionId)).toBe(0);
  });
});

describe("tiền về TRỄ (đơn đã hết hạn, chỗ đã trả lại)", () => {
  it("buổi còn chỗ → giữ lại chỗ, CONFIRMED", async () => {
    const { code, sessionId, total } = await setup({ quantity: 2 });
    await expire(code);
    expect(await seatsOf(sessionId)).toBe(0);

    expect((await processSepayTransfer(transfer(transferContentFor(code), total))).outcome).toBe("CONFIRMED");

    const b = await bookingOf(code);
    expect(b.status).toBe("CONFIRMED");
    expect(b.statusHistory.at(-1)).toMatchObject({ fromStatus: "EXPIRED", toStatus: "CONFIRMED" });
    expect(await seatsOf(sessionId)).toBe(2);
  });

  it("buổi đã hết chỗ → không bán vượt: đơn vẫn EXPIRED, tiền chờ hoàn", async () => {
    const { code, sessionId, total } = await setup({ quantity: 2, capacity: 2 });
    await expire(code);
    await createBooking({
      idempotencyKey: crypto.randomUUID(),
      sessionId,
      quantity: 2,
      contactName: "Người khác",
      contactEmail: "khac@example.com",
      contactPhone: "0907654321",
    }); // người khác lấy hết 2 chỗ vừa được trả

    expect((await processSepayTransfer(transfer(transferContentFor(code), total))).outcome).toBe("REFUND_PENDING");

    const b = await bookingOf(code);
    expect(b.status).toBe("EXPIRED");
    expect(b.payments[0]).toMatchObject({ status: "REFUND_PENDING", refundAmount: total });
    expect(await seatsOf(sessionId)).toBe(2);
  });

  // Tiền về ĐÚNG LÚC job đang cho đơn hết hạn. Dù bên nào vào hàng trước, khách đã trả đủ thì phải có chỗ,
  // và số chỗ của buổi phải khớp (không trả chỗ 2 lần, không giữ chỗ 2 lần).
  it.each([["job tới trước", "job"], ["tiền tới trước", "payment"]] as const)(
    "CẠNH TRANH: tiền về đúng lúc hết hạn (%s) → CONFIRMED, số chỗ đúng",
    async (_l, first) => {
      const { code, sessionId, total } = await setup({ quantity: 3 });
      const { id } = await prisma.booking.update({ where: { code }, data: { expiresAt: new Date(Date.now() - 1000) } });

      const pay = () => processSepayTransfer(transfer(transferContentFor(code), total));
      const job = () => expireOverdueBookings();
      const results = await raceOnRow("bookings", id, first === "job" ? [job, pay] : [pay, job], { ordered: true });

      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      expect((await bookingOf(code)).status).toBe("CONFIRMED");
      expect(await seatsOf(sessionId)).toBe(3);
    },
  );
});

describe("các trường hợp khác", () => {
  it("đơn đã thanh toán đủ, khách lỡ chuyển lần 2 → khoản thứ hai chờ hoàn toàn bộ", async () => {
    const { code, total } = await setup();
    await processSepayTransfer(transfer(transferContentFor(code), total));

    expect((await processSepayTransfer(transfer(transferContentFor(code), total))).outcome).toBe("REFUND_PENDING");
    const b = await bookingOf(code);
    expect(b.payments.map((p) => p.status)).toEqual(["SUCCEEDED", "REFUND_PENDING"]);
  });

  it("admin huỷ đơn đã thanh toán → tiền chờ hoàn", async () => {
    const { code, total } = await setup();
    await processSepayTransfer(transfer(transferContentFor(code), total));

    await cancelBooking((await bookingOf(code)).id, admin, "Khách xin huỷ");

    expect((await bookingOf(code)).payments[0]).toMatchObject({ status: "REFUND_PENDING", refundAmount: total });
  });

  it("nội dung không có mã đơn / mã không tồn tại → UNMATCHED, vẫn lưu lại để đối soát", async () => {
    expect((await processSepayTransfer(transfer("chuyen tien an trua", 50_000))).outcome).toBe("UNMATCHED");
    expect((await processSepayTransfer(transfer("TRA2222AA", 50_000))).outcome).toBe("UNMATCHED");
    expect(await prisma.webhookEvent.count({ where: { outcome: "UNMATCHED" } })).toBe(2);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("tiền RA khỏi tài khoản → IGNORED", async () => {
    const { code, total } = await setup();
    expect((await processSepayTransfer(transfer(transferContentFor(code), total, { transferType: "out" }))).outcome).toBe("IGNORED");
    expect((await bookingOf(code)).status).toBe("PENDING");
  });
});

describe("route POST /api/webhooks/sepay", () => {
  const request = (body: string, headers: Record<string, string>) =>
    new Request("http://localhost/api/webhooks/sepay", { method: "POST", body, headers });
  const signed = (body: string) => {
    const ts = Math.floor(Date.now() / 1000);
    return { "content-type": "application/json", "x-sepay-timestamp": String(ts), "x-sepay-signature": signSepayBody(SECRET, ts, body) };
  };

  it("chữ ký đúng → 200 {success:true}, đơn được xác nhận", async () => {
    const { code, total } = await setup();
    const body = JSON.stringify(transfer(transferContentFor(code), total));

    const res = await POST(request(body, signed(body)));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, outcome: "CONFIRMED" });
    expect((await bookingOf(code)).status).toBe("CONFIRMED");
  });

  it("chữ ký sai → 401, KHÔNG ghi gì vào DB (kẻ gian không 'chiếm trước' được mã giao dịch)", async () => {
    const { code, total } = await setup();
    const fake = transfer(transferContentFor(code), total);
    const body = JSON.stringify(fake);

    const res = await POST(request(body, { ...signed(body), "x-sepay-signature": signSepayBody("doan-mo", 1, body) }));

    expect(res.status).toBe(401);
    expect(await prisma.webhookEvent.count()).toBe(0);
    expect((await bookingOf(code)).status).toBe("PENDING");

    // Webhook THẬT cùng mã giao dịch tới sau vẫn được xử lý bình thường
    const real = await POST(request(body, signed(body)));
    expect(await real.json()).toMatchObject({ outcome: "CONFIRMED" });
  });

  it("chữ ký đúng nhưng payload sai định dạng → 400", async () => {
    const body = JSON.stringify({ id: 1, hello: "world" });
    expect((await POST(request(body, signed(body)))).status).toBe(400);
  });
});
