// Ghi dấu vết mỗi lần đơn đổi trạng thái — dùng chung cho nhân viên (lib/booking-admin.ts),
// job hết hạn và thanh toán tự động (lib/payments.ts).
import type { Prisma } from "@/generated/prisma/client";
import type { BookingStatus } from "@/generated/prisma/enums";
import { type ActorRef, writeAuditLog } from "@/lib/audit";

// Ghi LỊCH SỬ TRẠNG THÁI (cho đơn) + AUDIT LOG (cho cả hệ thống) — cùng transaction với thay đổi:
// thay đổi thành công thì chắc chắn có dấu vết; thay đổi bị huỷ thì dấu vết cũng biến mất.
export async function recordTransition(
  tx: Prisma.TransactionClient,
  t: {
    bookingId: string;
    from: BookingStatus;
    to: BookingStatus;
    actor: ActorRef;
    action: string;
    note?: string;
    metadata?: Prisma.InputJsonObject;
  },
) {
  await tx.bookingStatusHistory.create({
    data: {
      bookingId: t.bookingId,
      fromStatus: t.from,
      toStatus: t.to,
      actorType: t.actor.type,
      actorUserId: t.actor.userId,
      note: t.note,
    },
  });
  await writeAuditLog(tx, {
    actor: t.actor,
    action: t.action,
    entityType: "Booking",
    entityId: t.bookingId,
    metadata: { from: t.from, to: t.to, ...t.metadata },
  });
}
