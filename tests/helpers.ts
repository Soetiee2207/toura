// Tiện ích dùng chung cho các test.
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// ÉP CUỘC ĐUA XẢY RA THẬT: chạy nhanh quá thì các request nối đuôi nhau, không bao giờ "đụng" nhau.
// 1) Một transaction "người gác" khoá dòng cần tranh chấp (SELECT ... FOR UPDATE).
// 2) Chạy các tác vụ: tất cả đều ĐỌC được trạng thái cũ (Postgres không chặn việc đọc) rồi KẸT ở bước UPDATE.
// 3) Chờ tới khi đủ `tasks.length` request đang kẹt, mới thả khoá → chúng ùa vào cùng lúc.
// ordered = true: khởi động TỪNG tác vụ, chờ nó kẹt rồi mới tới tác vụ sau → Postgres xếp hàng đúng thứ tự
// trong mảng (ai vào hàng trước được xử lý trước). Dùng khi muốn kiểm tra CẢ HAI thứ tự "ai thắng".
export async function raceOnRow(
  table: "bookings" | "sessions",
  id: string,
  tasks: (() => Promise<unknown>)[],
  { ordered = false } = {},
) {
  let release!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const lockAcquired = new Promise<void>((r) => (locked = r));

  const guard = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM ${Prisma.raw(table)} WHERE id = ${id}::uuid FOR UPDATE`;
      locked();
      await gate;
    },
    { timeout: 10_000 },
  );
  await lockAcquired;

  let results: Promise<PromiseSettledResult<unknown>[]>;
  if (ordered) {
    const started: Promise<unknown>[] = [];
    for (const [i, task] of tasks.entries()) {
      started.push(task());
      await waitForLockWaiters(i + 1);
    }
    results = Promise.allSettled(started);
  } else {
    results = Promise.allSettled(tasks.map((t) => t()));
    await waitForLockWaiters(tasks.length);
  }
  release();
  await guard;
  return results;
}

async function waitForLockWaiters(n: number) {
  for (let i = 0; i < 200; i++) {
    const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (waiting >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}
