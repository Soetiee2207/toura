// Proxy (Next.js 16, trước đây gọi là Middleware): chạy TRƯỚC mọi request khớp `matcher`.
// Ở đây chỉ làm "kiểm tra lạc quan": không có cookie hợp lệ → chuyển ngay về trang đăng nhập, khỏi render trang.
// ⚠️ Đây KHÔNG phải lớp bảo vệ chính (không kiểm tra DB, không kiểm tra vai trò).
//    Lớp chính là requireUser() trong lib/auth.ts, gọi ở từng trang và từng Server Action.
import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/session-token";

const SESSION_COOKIE = "toura_session"; // trùng với lib/auth.ts (không import vì file đó là server-only + dùng DB)

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/admin/login") return NextResponse.next();

  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
