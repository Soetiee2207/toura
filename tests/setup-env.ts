// Trỏ DATABASE_URL sang database TEST trước khi bất kỳ code nào import lib/prisma.
// Nhờ vậy test không bao giờ đụng vào dữ liệu dev.
import "dotenv/config";

if (!process.env.DATABASE_URL_TEST) {
  throw new Error("Thiếu DATABASE_URL_TEST trong .env (xem .env.example)");
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
