import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Mỗi PrismaClient mở một pool kết nối riêng tới Postgres.
// Khi chạy `next dev`, hot reload nạp lại module liên tục → nếu tạo client mới
// mỗi lần sẽ cạn kết nối. Vì vậy ta cất client vào globalThis để tái sử dụng.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
