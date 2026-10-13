// Token đăng nhập lưu trong cookie, được KÝ bằng HMAC — cùng kỹ thuật dùng để xác thực webhook thanh toán.
//
//   token = base64url(payload) + "." + base64url(HMAC_SHA256(payload, AUTH_SECRET))
//   payload = { uid: "<user id>", exp: <hết hạn, tính bằng giây> }
//
// Payload KHÔNG bí mật (ai cũng giải mã base64 được) nhưng KHÔNG SỬA ĐƯỢC:
// đổi uid thành id của admin → chữ ký không còn khớp → bị từ chối. Muốn ký lại phải có AUTH_SECRET.
//
// File này không import gì của Next.js → dùng được ở cả proxy.ts, server và test.
import { createHmac, timingSafeEqual } from "node:crypto";

export type SessionPayload = { uid: string; exp: number };

export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8 tiếng = 1 ca làm việc

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET chưa được đặt hoặc quá ngắn (cần >= 32 ký tự)");
  return s;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createSessionToken(uid: string, now = Date.now()): string {
  const payload: SessionPayload = { uid, exp: Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
}

// Trả về payload nếu token hợp lệ và còn hạn; ngược lại trả về null (không bao giờ throw).
export function verifySessionToken(token: string | undefined, now = Date.now()): SessionPayload | null {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;

  const expected = Buffer.from(sign(data));
  const actual = Buffer.from(sig);
  // So sánh thời gian hằng số (giống verifyPassword) để không lộ thông tin qua thời gian phản hồi
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as SessionPayload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 <= now) return null; // hết hạn
    return payload;
  } catch {
    return null;
  }
}
