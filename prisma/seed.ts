// Dữ liệu mẫu cho môi trường dev. Chạy: npx prisma db seed
// Seed phải chạy lại được nhiều lần mà không nhân đôi dữ liệu (idempotent) → dùng upsert theo khóa unique.
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/password";

if (process.env.NODE_ENV === "production") {
  throw new Error("Không chạy seed trên production!");
}

const DEV_PASSWORD = process.env.SEED_USER_PASSWORD ?? "toura123";

const experiences = [
  {
    slug: "tour-am-thuc-pho-co",
    title: "Tour ẩm thực phố cổ Hà Nội",
    description:
      "Đi bộ 3 tiếng qua các con phố cổ, thưởng thức 6 món đặc sản: bún chả, nem rán, bánh cuốn, chè, cà phê trứng và kem Tràng Tiền.",
    meetingPoint: "Tượng đài Lý Thái Tổ, Hồ Gươm",
    durationMinutes: 180,
    defaultPrice: 350_000,
    sessionHourVN: 18,
    capacity: 10,
  },
  {
    slug: "workshop-lam-gom-bat-trang",
    title: "Workshop làm gốm Bát Tràng",
    description:
      "Tự tay nặn và vẽ một sản phẩm gốm dưới sự hướng dẫn của nghệ nhân. Sản phẩm được nung và gửi về sau 1 tuần.",
    meetingPoint: "Xưởng gốm số 12, làng Bát Tràng",
    durationMinutes: 150,
    defaultPrice: 450_000,
    sessionHourVN: 9,
    capacity: 8,
  },
  {
    slug: "dap-xe-ven-song-hong",
    title: "Đạp xe ven sông Hồng",
    description: "Đạp xe 20km qua bãi giữa sông Hồng và làng hoa Nhật Tân, có xe và mũ bảo hiểm.",
    meetingPoint: "Chân cầu Long Biên (phía Phúc Xá)",
    durationMinutes: 240,
    defaultPrice: 300_000,
    sessionHourVN: 7,
    capacity: 12,
  },
];

// Giờ Việt Nam = UTC+7 (không có giờ mùa hè). DB lưu timestamptz, nên ta tạo mốc theo UTC.
function vnTime(daysFromToday: number, hourVN: number): Date {
  const d = new Date(Date.now() + 7 * 3600_000); // "hôm nay" theo lịch Việt Nam, không theo UTC
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  d.setUTCHours(hourVN - 7, 0, 0, 0);
  return d;
}

async function main() {
  // 1. Tài khoản nội bộ
  for (const u of [
    { email: "admin@toura.local", name: "Quản trị viên", role: "ADMIN" as const },
    { email: "staff@toura.local", name: "Nhân viên check-in", role: "STAFF" as const },
  ]) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash: await hashPassword(DEV_PASSWORD) }, // mỗi user 1 salt riêng
    });
  }

  // 2. Trải nghiệm + 7 buổi tổ chức trong 7 ngày tới
  for (const { sessionHourVN, capacity, ...data } of experiences) {
    const exp = await prisma.experience.upsert({
      where: { slug: data.slug },
      update: {},
      create: { ...data, isPublished: true },
    });

    const existing = await prisma.session.count({ where: { experienceId: exp.id } });
    if (existing > 0) continue; // đã seed rồi → bỏ qua

    await prisma.session.createMany({
      data: Array.from({ length: 7 }, (_, i) => ({
        experienceId: exp.id,
        startsAt: vnTime(i + 1, sessionHourVN),
        capacity,
        price: exp.defaultPrice,
        status: "OPEN" as const,
      })),
    });
  }

  const [users, exps, sessions] = await Promise.all([
    prisma.user.count(),
    prisma.experience.count(),
    prisma.session.count(),
  ]);
  console.log(`✔ Seed xong: ${users} users, ${exps} experiences, ${sessions} sessions`);
  console.log(`  Đăng nhập: admin@toura.local / staff@toura.local — mật khẩu: ${DEV_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
