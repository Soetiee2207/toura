// Chạy 1 lần trước toàn bộ test: áp dụng mọi migration lên database test.
import "dotenv/config";
import { execSync } from "node:child_process";

export default function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("Thiếu DATABASE_URL_TEST trong .env (xem .env.example)");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
