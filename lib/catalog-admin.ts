// Quản lý DANH MỤC từ phía admin: tạo/sửa trải nghiệm, tạo/sửa buổi.
// Giống lib/booking-admin.ts: không tự kiểm tra đăng nhập (Server Action làm), nhưng giữ MỌI luật nghiệp vụ.
// Không có hàm XOÁ: trải nghiệm thì ẩn (isPublished = false), buổi thì huỷ — để không mất lịch sử đơn.
import { Prisma } from "@/generated/prisma/client";
import type { SessionStatus } from "@/generated/prisma/enums";
import { type Actor, staffRef, writeAuditLog } from "@/lib/audit";
import type { CreateSessionInput, ExperienceInput, UpdateSessionInput } from "@/lib/catalog-schema";
import { prisma } from "@/lib/prisma";

export type CatalogErrorCode =
  | "NOT_FOUND"
  | "SLUG_TAKEN"
  | "STARTS_IN_PAST"
  | "INVALID_TRANSITION"
  | "CAPACITY_BELOW_BOOKED"
  | "HAS_BOOKINGS"
  | "CONFLICT";

export class CatalogError extends Error {
  constructor(
    public readonly code: CatalogErrorCode,
    message: string,
    public readonly field?: string, // lỗi gắn với ô nào trên form (nếu có)
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

// ── TRẢI NGHIỆM ────────────────────────────────────────────

export async function createExperience(actor: Actor, data: ExperienceInput): Promise<{ id: string }> {
  return withSlugCheck(() =>
    prisma.$transaction(async (tx) => {
      const exp = await tx.experience.create({ data, select: { id: true } });
      await writeAuditLog(tx, {
        actor: staffRef(actor),
        action: "experience.create",
        entityType: "Experience",
        entityId: exp.id,
        metadata: { ...data },
      });
      return exp;
    }),
  );
}

export async function updateExperience(actor: Actor, id: string, data: ExperienceInput): Promise<void> {
  await withSlugCheck(() =>
    prisma.$transaction(async (tx) => {
      const before = await tx.experience.findUnique({ where: { id }, select: experienceFields });
      if (!before) throw new CatalogError("NOT_FOUND", "Không tìm thấy trải nghiệm.");

      const changes = diff(before, data);
      if (Object.keys(changes).length === 0) return; // không đổi gì → khỏi ghi

      await tx.experience.update({ where: { id }, data });
      await writeAuditLog(tx, {
        actor: staffRef(actor),
        action: "experience.update",
        entityType: "Experience",
        entityId: id,
        metadata: { changes },
      });
    }),
  );
}

const experienceFields = {
  title: true,
  slug: true,
  description: true,
  meetingPoint: true,
  durationMinutes: true,
  defaultPrice: true,
  isPublished: true,
} as const;

// slug là UNIQUE trong DB. Không "kiểm tra trước rồi mới tạo" (2 admin cùng lúc vẫn trùng được),
// mà cứ ghi → để DB từ chối (lỗi P2002) → đổi thành thông báo dễ hiểu.
async function withSlugCheck<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new CatalogError("SLUG_TAKEN", "Slug này đã được dùng cho trải nghiệm khác.", "slug");
    }
    throw e;
  }
}

// ── BUỔI ───────────────────────────────────────────────────

// MÁY TRẠNG THÁI của buổi. CANCELLED là điểm cuối.
// (Không có OPEN → DRAFT: buổi đã mở bán thì muốn dừng là CLOSED, để khách đang giữ chỗ vẫn thấy buổi.)
const SESSION_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["CLOSED", "CANCELLED"],
  CLOSED: ["OPEN", "CANCELLED"],
  CANCELLED: [],
};

// Các trạng thái có thể chọn trên form (giữ nguyên + được phép chuyển sang)
export function sessionStatusOptions(from: SessionStatus): SessionStatus[] {
  return [from, ...SESSION_TRANSITIONS[from]];
}

export async function createSession(actor: Actor, data: CreateSessionInput): Promise<void> {
  if (data.startsAt <= new Date()) {
    throw new CatalogError("STARTS_IN_PAST", "Giờ bắt đầu phải ở tương lai.", "startsAt");
  }
  await prisma.$transaction(async (tx) => {
    const exp = await tx.experience.findUnique({ where: { id: data.experienceId }, select: { id: true } });
    if (!exp) throw new CatalogError("NOT_FOUND", "Không tìm thấy trải nghiệm.");

    const session = await tx.session.create({ data, select: { id: true } });
    await writeAuditLog(tx, {
      actor: staffRef(actor),
      action: "session.create",
      entityType: "Session",
      entityId: session.id,
      metadata: { ...data, startsAt: data.startsAt.toISOString() },
    });
  });
}

export async function updateSession(actor: Actor, data: UpdateSessionInput): Promise<void> {
  const { sessionId, capacity, price, status } = data;

  await prisma.$transaction(async (tx) => {
    const before = await tx.session.findUnique({
      where: { id: sessionId },
      select: { status: true, capacity: true, price: true, seatsBooked: true },
    });
    if (!before) throw new CatalogError("NOT_FOUND", "Không tìm thấy buổi.");
    if (before.status === "CANCELLED") {
      throw new CatalogError("INVALID_TRANSITION", "Buổi đã huỷ, không thể sửa.");
    }
    if (status !== before.status && !SESSION_TRANSITIONS[before.status].includes(status)) {
      throw new CatalogError("INVALID_TRANSITION", `Không thể chuyển buổi từ ${before.status} sang ${status}.`, "status");
    }

    // ĐIỀU KIỆN NẰM TRONG CÂU UPDATE (giống lib/booking.ts và compareAndSet):
    //  - status vẫn như lúc đọc (không ai đổi giữa chừng)
    //  - giảm sức chứa: số chỗ ĐÃ GIỮ phải ≤ sức chứa mới — kiểm tra ngay lúc ghi, vì khách có thể
    //    vừa đặt thêm chỗ sau khi mình đọc `before`
    //  - huỷ buổi: phải không còn chỗ nào đang giữ
    const { count } = await tx.session.updateMany({
      where: {
        id: sessionId,
        status: before.status,
        seatsBooked: status === "CANCELLED" ? 0 : { lte: capacity },
      },
      data: { capacity, price, status },
    });

    if (count === 0) {
      // Không ghi được → đọc lại để biết lý do (đọc trong cùng transaction vẫn thấy dữ liệu mới nhất đã commit)
      const now = await tx.session.findUniqueOrThrow({ where: { id: sessionId }, select: { status: true, seatsBooked: true } });
      if (now.status !== before.status) {
        throw new CatalogError("CONFLICT", "Buổi vừa được người khác cập nhật. Vui lòng tải lại trang.");
      }
      if (status === "CANCELLED") {
        throw new CatalogError(
          "HAS_BOOKINGS",
          `Buổi đang có ${now.seatsBooked} chỗ được giữ. Hãy huỷ các đơn trước rồi mới huỷ buổi.`,
          "status",
        );
      }
      throw new CatalogError(
        "CAPACITY_BELOW_BOOKED",
        `Đã có ${now.seatsBooked} chỗ được giữ, sức chứa không thể nhỏ hơn số này.`,
        "capacity",
      );
    }

    const changes = diff(before, { capacity, price, status });
    if (Object.keys(changes).length > 0) {
      await writeAuditLog(tx, {
        actor: staffRef(actor),
        action: status === "CANCELLED" ? "session.cancel" : "session.update",
        entityType: "Session",
        entityId: sessionId,
        metadata: { changes },
      });
    }
  });
}

// Chỉ giữ các trường THỰC SỰ thay đổi: { price: { from: 350000, to: 400000 } }
function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const changes: Record<string, { from: Prisma.InputJsonValue; to: Prisma.InputJsonValue }> = {};
  for (const key of Object.keys(after) as (keyof T & string)[]) {
    if (before[key] !== after[key]) {
      changes[key] = { from: before[key] as Prisma.InputJsonValue, to: after[key] as Prisma.InputJsonValue };
    }
  }
  return changes;
}

// ── ĐỌC DỮ LIỆU CHO TRANG ADMIN ────────────────────────────
// Khác lib/catalog.ts (trang khách): admin thấy CẢ trải nghiệm chưa công khai và mọi trạng thái buổi.

export async function listExperiencesForAdmin() {
  const now = new Date();
  return prisma.experience.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      isPublished: true,
      defaultPrice: true,
      _count: { select: { sessions: { where: { startsAt: { gt: now }, status: { not: "CANCELLED" } } } } },
    },
  });
}

export async function getExperienceForAdmin(id: string) {
  return prisma.experience.findUnique({
    where: { id },
    select: {
      id: true,
      ...experienceFields,
      updatedAt: true,
      sessions: {
        // Buổi sắp tới + buổi trong 30 ngày qua (buổi cũ hơn không cần sửa nữa)
        where: { startsAt: { gt: new Date(Date.now() - 30 * 24 * 3600_000) } },
        orderBy: { startsAt: "asc" },
        select: { id: true, startsAt: true, capacity: true, seatsBooked: true, price: true, status: true, updatedAt: true },
      },
    },
  });
}
