// Giao tiếp với SePay (dịch vụ theo dõi tài khoản ngân hàng, gửi webhook khi có tiền vào).
// File này CHỈ lo phần "giao thức": kiểm tra chữ ký, đọc dữ liệu, tìm mã đơn. Không đụng database
// → test được độc lập, và đổi sang cổng khác thì nghiệp vụ trong lib/payments.ts không phải sửa.
// Tài liệu: https://developer.sepay.vn/en/sepay-webhooks/xac-thuc
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// ── XÁC THỰC: request có đúng do SePay gửi không? ──────────
// SePay ký: HMAC-SHA256(secret, "{timestamp}.{body gốc}") → header "X-SePay-Signature: sha256={hex}".
// Kẻ gian không có secret → không tạo được chữ ký đúng, dù biết hết định dạng.
// Timestamp nằm TRONG chuỗi được ký → không sửa được; lệch quá 5 phút → từ chối (chống gửi lại request cũ đã bắt được).
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signSepayBody(secret: string, timestamp: number, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifySepaySignature(input: {
  secret: string;
  rawBody: string; // body NGUYÊN VĂN — parse JSON rồi stringify lại có thể đổi thứ tự/khoảng trắng → lệch chữ ký
  signature: string | null;
  timestamp: string | null;
  now?: Date;
}): boolean {
  const { secret, rawBody, signature, timestamp, now = new Date() } = input;
  if (!signature || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;

  const ts = Number(timestamp);
  if (Math.abs(now.getTime() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(signSepayBody(secret, ts, rawBody));
  const actual = Buffer.from(signature);
  // So sánh thời gian hằng số (giống verifyPassword): không để lộ "đúng được bao nhiêu ký tự" qua thời gian phản hồi
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ── DỮ LIỆU WEBHOOK ────────────────────────────────────────
// Chỉ lấy các trường mình cần; trường lạ bị bỏ qua (zod mặc định), nhưng payload gốc vẫn được lưu nguyên văn.
export const sepayTransferSchema = z.object({
  id: z.number().int().positive(), // mã giao dịch phía SePay — DUY NHẤT → dùng để chống xử lý trùng
  gateway: z.string(),
  transactionDate: z.string(),
  accountNumber: z.string(),
  code: z.string().nullish(), // mã thanh toán SePay tự nhận diện (nếu đã cấu hình), có thể null
  content: z.string(), // nội dung chuyển khoản khách gõ
  transferType: z.enum(["in", "out"]),
  transferAmount: z.number().int().positive(),
  referenceCode: z.string().nullish(),
});
export type SepayTransfer = z.infer<typeof sepayTransferSchema>;

// ── TÌM MÃ ĐƠN TRONG NỘI DUNG CHUYỂN KHOẢN ─────────────────
// Mã đơn: TRA-XXXXXX. Nhưng nhiều ngân hàng BỎ dấu "-" và tự chèn thêm chữ vào nội dung, ví dụ:
//   "TRA7X3K9A chuyen tien"   "MBVCB.1234.tra 7x3k9a.CT tu 0123"
// → chấp nhận TRA + (gạch/cách/chấm hoặc không) + 6 ký tự trong bảng chữ của mã đơn (không có 0, 1, I, L, O).
// Đứng sau 6 ký tự KHÔNG được là chữ/số nữa — tránh khớp nhầm một chuỗi dài hơn.
const BOOKING_CODE_IN_TEXT = /TRA[\s\-_.]?([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6})(?![A-Z0-9])/i;

export function extractBookingCode(text: string | null | undefined): string | null {
  const m = text?.match(BOOKING_CODE_IN_TEXT);
  return m ? `TRA-${m[1].toUpperCase()}` : null;
}

// Nội dung chuyển khoản hiển thị cho khách: bỏ dấu "-" để ngân hàng không cắt mất.
export function transferContentFor(bookingCode: string): string {
  return bookingCode.replace("-", "");
}

// ── TÀI KHOẢN NHẬN TIỀN + MÃ QR ────────────────────────────
// Đọc từ .env (không hard-code số tài khoản vào code). Thiếu biến nào → null → trang khách báo "chưa cấu hình".
export type BankAccount = { accountNumber: string; bank: string; accountName: string };

export function bankAccountFromEnv(env: Record<string, string | undefined> = process.env): BankAccount | null {
  const accountNumber = env.SEPAY_BANK_ACCOUNT?.trim();
  const bank = env.SEPAY_BANK_CODE?.trim();
  const accountName = env.SEPAY_ACCOUNT_NAME?.trim();
  if (!accountNumber || !bank || !accountName) return null;
  return { accountNumber, bank, accountName };
}

// Ảnh QR VietQR do SePay vẽ sẵn: khách quét bằng app ngân hàng → tự điền số tài khoản, số tiền, nội dung.
// Khách KHÔNG phải gõ tay nội dung → gần như không bao giờ sai mã đơn.
// Tài liệu: https://qr.sepay.vn — tham số: acc, bank, amount, des.
export function sepayQrUrl(account: BankAccount, amount: number, content: string): string {
  const params = new URLSearchParams({
    acc: account.accountNumber,
    bank: account.bank,
    amount: String(amount),
    des: content,
  });
  return `https://qr.sepay.vn/img?${params}`; // URLSearchParams tự mã hoá ký tự đặc biệt
}
