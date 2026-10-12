import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// Subset "vietnamese" để hiển thị đúng dấu tiếng Việt (ẩ, ự, ờ...)
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "vietnamese"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Toura — Trải nghiệm địa phương",
  description: "Đặt tour ngắn và workshop trong ngày cùng người địa phương.",
};

// Layout gốc: bọc MỌI trang. Header/footer đặt ở đây để không phải lặp lại.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex h-14 max-w-5xl items-center px-4">
            <Link href="/" className="text-lg font-bold tracking-tight text-emerald-700">
              Toura
            </Link>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-stone-200 py-6 text-center text-sm text-stone-500">
          © Toura — Trải nghiệm địa phương
        </footer>
      </body>
    </html>
  );
}
