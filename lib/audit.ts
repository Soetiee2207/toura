// AUDIT LOG: nhật ký "ai đã làm gì, với cái gì, lúc nào" cho TOÀN hệ thống.
// Luôn ghi BÊN TRONG transaction của thay đổi (truyền `tx` vào): thay đổi thành công ⇔ có dòng log.
import type { Prisma } from "@/generated/prisma/client";
import type { ActorType, UserRole } from "@/generated/prisma/enums";

// Nhân viên đang thao tác (lấy từ requireUser()).
export type Actor = { id: string; role: UserRole };

// Ai thực hiện thay đổi. Nhân viên có userId; hệ thống (job tự động) thì không.
export type ActorRef = { type: ActorType; userId: string | null };
export const staffRef = (a: Actor): ActorRef => ({ type: a.role, userId: a.id });
export const SYSTEM: ActorRef = { type: "SYSTEM", userId: null };

export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  entry: { actor: ActorRef; action: string; entityType: string; entityId: string; metadata?: Prisma.InputJsonObject },
) {
  await tx.auditLog.create({
    data: {
      actorType: entry.actor.type,
      actorUserId: entry.actor.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
    },
  });
}
