// Báo cáo doanh thu theo THÁNG cho admin.
// Quy ước:
//  - Doanh thu = tổng tiền các đơn CONFIRMED (đã thu tiền). Đơn PENDING chỉ là "đang chờ", không tính.
//  - Tính theo NGÀY DIỄN RA BUỔI (session.starts_at), không theo ngày đặt: tour tháng 11 đặt từ tháng 10
//    là doanh thu tháng 11 — tháng mà dịch vụ thật sự được cung cấp.
//  - "Tháng" là tháng theo GIỜ VIỆT NAM: buổi 00:30 ngày 1/11 (giờ VN) = 17:30 ngày 31/10 (UTC) vẫn thuộc tháng 11.
//  - Bỏ qua buổi đã huỷ (không còn đơn nào giữ chỗ — xem updateSession trong lib/catalog-admin.ts).
import { TIME_ZONE } from "@/lib/format";
import { prisma } from "@/lib/prisma";

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isValidMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH_RE.test(value);
}

// Tháng hiện tại theo giờ VN, dạng "2026-10". (Locale en-CA định dạng ngày kiểu ISO: 2026-10-14)
export function currentMonthVN(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit" }).format(now);
}

// Cộng/trừ tháng: shiftMonth("2026-12", 1) → "2027-01"
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

// Khoảng [from, to) của một tháng theo giờ VN, dưới dạng thời điểm tuyệt đối.
// Dùng "< to" (không phải "<= 23:59:59") → không sót buổi lúc 23:59:30.
export function monthRangeVN(month: string): { from: Date; to: Date } {
  return {
    from: new Date(`${month}-01T00:00:00+07:00`),
    to: new Date(`${shiftMonth(month, 1)}-01T00:00:00+07:00`),
  };
}

export type ReportRow = {
  experienceId: string;
  title: string;
  sessions: number;
  capacity: number;
  guests: number; // số khách của đơn CONFIRMED
  revenue: number; // VND, đơn CONFIRMED
  pendingAmount: number; // VND, đơn PENDING còn hạn — có thể thành doanh thu
};

export async function getMonthlyReport(month: string, now = new Date()) {
  const { from, to } = monthRangeVN(month);

  // Gộp 2 tầng: (1) mỗi BUỔI cộng đơn của nó, (2) mỗi TRẢI NGHIỆM cộng các buổi.
  // Không JOIN thẳng sessions ⋈ bookings rồi SUM(capacity): buổi có 3 đơn sẽ bị cộng capacity 3 lần.
  // ${...} trong $queryRaw là THAM SỐ ($1, $2...), không phải nối chuỗi → không bị SQL injection.
  // SUM() trả về bigint (tổng doanh thu có thể vượt 2,1 tỷ = giới hạn int4) → đổi sang number ở dưới.
  const rows = await prisma.$queryRaw<
    { experience_id: string; title: string; sessions: bigint; capacity: bigint; guests: bigint; revenue: bigint; pending_amount: bigint }[]
  >`
    WITH per_session AS (
      SELECT s.id, s.experience_id, s.capacity,
             COALESCE(SUM(b.quantity)     FILTER (WHERE b.status = 'CONFIRMED'), 0) AS guests,
             COALESCE(SUM(b.total_amount) FILTER (WHERE b.status = 'CONFIRMED'), 0) AS revenue,
             COALESCE(SUM(b.total_amount) FILTER (WHERE b.status = 'PENDING' AND b.expires_at > ${now}), 0) AS pending_amount
      FROM sessions s
      LEFT JOIN bookings b ON b.session_id = s.id
      WHERE s.starts_at >= ${from} AND s.starts_at < ${to} AND s.status <> 'CANCELLED'
      GROUP BY s.id
    )
    SELECT e.id AS experience_id, e.title,
           COUNT(*)            AS sessions,
           SUM(p.capacity)     AS capacity,
           SUM(p.guests)       AS guests,
           SUM(p.revenue)      AS revenue,
           SUM(p.pending_amount) AS pending_amount
    FROM per_session p
    JOIN experiences e ON e.id = p.experience_id
    GROUP BY e.id, e.title
    ORDER BY revenue DESC, e.title
  `;

  const result: ReportRow[] = rows.map((r) => ({
    experienceId: r.experience_id,
    title: r.title,
    sessions: Number(r.sessions),
    capacity: Number(r.capacity),
    guests: Number(r.guests),
    revenue: Number(r.revenue),
    pendingAmount: Number(r.pending_amount),
  }));

  const totals = result.reduce(
    (t, r) => ({
      sessions: t.sessions + r.sessions,
      capacity: t.capacity + r.capacity,
      guests: t.guests + r.guests,
      revenue: t.revenue + r.revenue,
      pendingAmount: t.pendingAmount + r.pendingAmount,
    }),
    { sessions: 0, capacity: 0, guests: 0, revenue: 0, pendingAmount: 0 },
  );

  return { month, rows: result, totals };
}
