import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSessionToken, SESSION_MAX_AGE_SECONDS, verifySessionToken } from "@/lib/session-token";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

// lib/auth.ts import "server-only" (chặn dùng ở trình duyệt) → trong test thay bằng module rỗng
vi.mock("server-only", () => ({}));
// lib/auth.ts dùng cookies()/redirect() của Next — authenticate() không cần tới, giả lập cho import được
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn() }));

describe("session token (cookie đăng nhập được ký HMAC)", () => {
  it("token hợp lệ → đọc lại đúng user id", () => {
    const token = createSessionToken("user-123");
    expect(verifySessionToken(token)?.uid).toBe("user-123");
  });

  it("sửa payload (đổi thành id người khác) → chữ ký không khớp → từ chối", () => {
    const token = createSessionToken("staff-1");
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin-1", exp: 9_999_999_999 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`)).toBeNull();
  });

  it("token hết hạn → từ chối", () => {
    const issuedAt = Date.now();
    const token = createSessionToken("user-123", issuedAt);
    const later = issuedAt + (SESSION_MAX_AGE_SECONDS + 1) * 1000;
    expect(verifySessionToken(token, later)).toBeNull();
  });

  it("token ký bằng khoá khác → từ chối", () => {
    const token = createSessionToken("user-123");
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "another-secret-another-secret-another-secret";
    try {
      expect(verifySessionToken(token)).toBeNull();
    } finally {
      process.env.AUTH_SECRET = original;
    }
  });

  it.each(["", "abc", "abc.def", "...", undefined])("chuỗi rác %j → từ chối, không throw", (t) => {
    expect(verifySessionToken(t)).toBeNull();
  });
});

describe("authenticate (đăng nhập bằng email + mật khẩu)", () => {
  let authenticate: typeof import("@/lib/auth").authenticate;

  beforeAll(async () => {
    ({ authenticate } = await import("@/lib/auth"));
    await prisma.user.deleteMany({ where: { email: { endsWith: "@auth-test.local" } } });
    await prisma.user.createMany({
      data: [
        { email: "active@auth-test.local", name: "Active", role: "STAFF", passwordHash: await hashPassword("dung-mat-khau") },
        { email: "locked@auth-test.local", name: "Locked", role: "ADMIN", passwordHash: await hashPassword("dung-mat-khau"), isActive: false },
      ],
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: "@auth-test.local" } } });
    await prisma.$disconnect();
  });

  it("đúng email + mật khẩu → trả về user, KHÔNG kèm passwordHash", async () => {
    const user = await authenticate("Active@Auth-Test.local ", "dung-mat-khau"); // hoa/thường + dấu cách vẫn nhận
    expect(user).toMatchObject({ email: "active@auth-test.local", role: "STAFF" });
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("sai mật khẩu → null", async () => {
    expect(await authenticate("active@auth-test.local", "sai")).toBeNull();
  });

  it("email không tồn tại → null", async () => {
    expect(await authenticate("ghost@auth-test.local", "dung-mat-khau")).toBeNull();
  });

  it("tài khoản đã bị khoá → null dù đúng mật khẩu", async () => {
    expect(await authenticate("locked@auth-test.local", "dung-mat-khau")).toBeNull();
  });
});
