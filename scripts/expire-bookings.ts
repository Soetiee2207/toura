// JOB: chuyển các đơn PENDING quá hạn giữ chỗ sang EXPIRED và trả chỗ cho buổi.
//   npm run jobs:expire                 → chạy MỘT lần rồi thoát (dùng với cron: mỗi phút gọi 1 lần)
//   npm run jobs:expire -- --every 60   → chạy mãi, cứ 60 giây một lần (dùng khi dev, hoặc container worker)
// Chạy lặp hay chạy chồng nhiều bản đều an toàn: xem expireOverdueBookings trong lib/booking-admin.ts.
import "dotenv/config";
import { expireOverdueBookings } from "../lib/booking-admin";
import { prisma } from "../lib/prisma";

async function runOnce() {
  const { scanned, expired } = await expireOverdueBookings();
  console.log(`[${new Date().toISOString()}] expire-bookings: ${expired}/${scanned} đơn đã hết hạn`);
}

async function main() {
  const i = process.argv.indexOf("--every");
  const everySeconds = i > -1 ? Number(process.argv[i + 1]) : 0;

  if (!everySeconds) {
    await runOnce();
    return;
  }
  if (!Number.isFinite(everySeconds) || everySeconds < 5) throw new Error("--every phải là số giây >= 5");

  let stopping = false;
  process.on("SIGINT", () => (stopping = true));
  process.on("SIGTERM", () => (stopping = true));
  while (!stopping) {
    // Lỗi một lượt (vd DB tạm mất kết nối) → ghi log rồi thử lại lượt sau, không chết hẳn
    await runOnce().catch((e) => console.error("expire-bookings lỗi:", e));
    // Chờ XONG lượt này rồi mới đếm giờ → không bao giờ 2 lượt chạy chồng nhau trong cùng tiến trình
    for (let waited = 0; waited < everySeconds && !stopping; waited++) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
