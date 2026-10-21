// TRÁI TIM CỦA HỆ THỐNG: tạo đơn đặt chỗ.
// Mọi nơi muốn tạo booking (form khách, sau này admin thêm khách thủ công...) đều PHẢI đi qua hàm này.
import { randomInt } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { CreateBookingInput } from "@/lib/booking-schema";

// Lỗi nghiệp vụ "dự kiến được" (hết chỗ, buổi đã đóng...) → trang hiển thị thông báo thân thiện.
// Phân biệt với lỗi bất ngờ (DB sập, bug) → trang báo lỗi chung.
export type BookingErrorCode = "SESSION_NOT_AVAILABLE" | "NOT_ENOUGH_SEATS" | "IDEMPOTENCY_CONFLICT";

export class BookingError extends Error {
  constructor(
    public readonly code: BookingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BookingError";
  }
}

function holdMinutes(): number {
  const n = Number(process.env.BOOKING_HOLD_MINUTES ?? 1440);
  return Number.isFinite(n) && n > 0 ? n : 1440;
}

// Mã đơn cho người đọc: TRA-XXXXXX. Bỏ các ký tự dễ nhầm khi đọc qua điện thoại (0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateBookingCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `TRA-${code}`;
}

export async function createBooking(input: CreateBookingInput): Promise<{ code: string }> {
  // IDEMPOTENCY: cùng 1 idempotencyKey gửi lại (bấm 2 lần, mạng chập chờn, gửi lặp bằng Postman...)
  // → trả về ĐƠN CŨ, không tạo đơn mới, không giữ thêm chỗ.
  const replay = await findReplay(input);
  if (replay) return replay;

  for (let attempt = 1; ; attempt++) {
    try {
      return await createBookingOnce(input, generateBookingCode());
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Vi phạm UNIQUE có 2 khả năng:
      //  (a) một request SONG SONG cùng idempotencyKey vừa tạo đơn xong trước mình → trả về đơn đó
      //  (b) mã đơn ngẫu nhiên bị trùng (cực hiếm) → thử lại với mã khác
      // Transaction của mình đã ROLLBACK nên chỗ đã giữ cũng được trả lại tự động.
      const replay = await findReplay(input);
      if (replay) return replay;
      if (attempt >= 3) throw e;
    }
  }
}

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// Tìm đơn đã tạo bằng cùng idempotencyKey.
// Cùng key nhưng KHÁC nội dung (buổi, số người, email) → không phải "gửi lặp" mà là dùng sai key → báo lỗi.
async function findReplay(input: CreateBookingInput): Promise<{ code: string } | null> {
  const existing = await prisma.booking.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { code: true, sessionId: true, quantity: true, contactEmail: true },
  });
  if (!existing) return null;

  const samePayload =
    existing.sessionId === input.sessionId &&
    existing.quantity === input.quantity &&
    existing.contactEmail === input.contactEmail;
  if (!samePayload) {
    throw new BookingError(
      "IDEMPOTENCY_CONFLICT",
      "Phiên đặt chỗ này đã được dùng cho một đơn khác. Bạn vui lòng tải lại trang và đặt lại.",
    );
  }
  return { code: existing.code };
}

// GIỮ CHỖ: một câu SQL duy nhất vừa KIỂM TRA vừa GHI (atomic). Trả về số dòng được cập nhật (0 = không giữ được).
// Điều kiện trong WHERE chính là quy tắc "buổi còn đặt được" (xem bookableSessionWhere ở lib/catalog.ts),
// cộng thêm "đủ chỗ cho quantity người". Postgres khoá dòng session này cho tới khi transaction kết thúc,
// nên 2 khách đặt cùng lúc sẽ phải XẾP HÀNG, người sau thấy số chỗ đã bị người trước trừ.
// Dùng ở 2 nơi: khách đặt chỗ, và tiền chuyển khoản về TRỄ cho đơn đã hết hạn (lib/payments.ts).
export function reserveSeats(tx: Prisma.TransactionClient, sessionId: string, quantity: number): Promise<number> {
  return tx.$executeRaw`
    UPDATE sessions s
    SET seats_booked = s.seats_booked + ${quantity}, updated_at = now()
    WHERE s.id = ${sessionId}::uuid
      AND s.status = 'OPEN'
      AND s.starts_at > now()
      AND s.seats_booked + ${quantity} <= s.capacity
      AND EXISTS (SELECT 1 FROM experiences e WHERE e.id = s.experience_id AND e.is_published)
  `;
}

async function createBookingOnce(input: CreateBookingInput, code: string) {
  const { sessionId, quantity } = input;

  // $transaction: tất cả câu lệnh bên trong cùng thành công, hoặc cùng bị huỷ (ROLLBACK).
  return prisma.$transaction(async (tx) => {
    // ── BƯỚC 1: GIỮ CHỖ — một câu SQL duy nhất vừa KIỂM TRA vừa GHI (atomic), xem reserveSeats ──
    const reserved = await reserveSeats(tx, sessionId, quantity);

    if (reserved === 0) {
      // Không giữ được chỗ → tìm lý do để báo khách cho đúng
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        select: { status: true, startsAt: true, capacity: true, seatsBooked: true, experience: { select: { isPublished: true } } },
      });
      const stillOpen =
        session &&
        session.status === "OPEN" &&
        session.startsAt > new Date() &&
        session.experience.isPublished;
      if (!stillOpen) {
        throw new BookingError("SESSION_NOT_AVAILABLE", "Buổi này hiện không còn mở bán.");
      }
      const left = session.capacity - session.seatsBooked;
      throw new BookingError(
        "NOT_ENOUGH_SEATS",
        left > 0 ? `Buổi này chỉ còn ${left} chỗ, bạn vui lòng giảm số người.` : "Buổi này vừa hết chỗ.",
      );
    }

    // ── BƯỚC 2: LẤY GIÁ TỪ DATABASE — không bao giờ tin giá gửi lên từ trình duyệt ──
    const session = await tx.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { price: true, startsAt: true },
    });

    // Hạn giữ chỗ: sau BOOKING_HOLD_MINUTES phút, nhưng không quá giờ bắt đầu buổi
    const holdUntil = new Date(Date.now() + holdMinutes() * 60_000);
    const expiresAt = holdUntil < session.startsAt ? holdUntil : session.startsAt;

    // ── BƯỚC 3: TẠO ĐƠN với giá SNAPSHOT + ghi lịch sử trạng thái đầu tiên ──
    const booking = await tx.booking.create({
      data: {
        code,
        idempotencyKey: input.idempotencyKey,
        sessionId,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        quantity,
        unitPrice: session.price,
        totalAmount: session.price * quantity,
        status: "PENDING",
        expiresAt,
        statusHistory: {
          create: { fromStatus: null, toStatus: "PENDING", actorType: "CUSTOMER", note: "Khách tạo đơn" },
        },
      },
      select: { code: true },
    });

    return booking;
  });
}

// ─────────────────────────────────────────────
// Xem đơn theo mã (trang /bookings/[code])
// ─────────────────────────────────────────────

// Ai có mã đơn là xem được đơn → KHÔNG trả về email/SĐT đầy đủ, chỉ bản che bớt.
function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"*".repeat(Math.max(name.length - 2, 1))}@${domain}`;
}
function maskPhone(phone: string) {
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}

export async function getBookingByCode(code: string) {
  const booking = await prisma.booking.findUnique({
    where: { code: code.toUpperCase() },
    select: {
      code: true,
      status: true,
      quantity: true,
      unitPrice: true,
      totalAmount: true,
      expiresAt: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      createdAt: true,
      session: {
        select: { startsAt: true, experience: { select: { title: true, meetingPoint: true, slug: true } } },
      },
    },
  });
  if (!booking) return null;

  const { contactEmail, contactPhone, ...rest } = booking;
  return { ...rest, maskedEmail: maskEmail(contactEmail), maskedPhone: maskPhone(contactPhone) };
}
