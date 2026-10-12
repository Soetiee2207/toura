import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Băm mật khẩu bằng scrypt (có sẵn trong Node, không cần thư viện ngoài).
// scrypt cố tình CHẬM và tốn RAM → kẻ gian lấy được DB cũng rất khó dò ngược mật khẩu.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

// Kết quả lưu vào DB có dạng "salt:hash" (hex).
// Salt ngẫu nhiên → 2 người cùng mật khẩu "123456" vẫn ra 2 hash khác nhau.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);

  // So sánh thời gian hằng số: không để lộ "đúng được bao nhiêu ký tự" qua thời gian phản hồi
  return timingSafeEqual(actual, expected);
}
