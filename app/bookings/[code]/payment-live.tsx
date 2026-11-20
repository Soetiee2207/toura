"use client";
// Phần "sống" của trang thanh toán — chạy trên TRÌNH DUYỆT (Server Component không có đồng hồ, không tự chạy lại được).
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

// ── ĐỒNG HỒ DÙNG CHUNG ─────────────────────────────────────
// useSyncExternalStore: React đọc giờ từ "nguồn bên ngoài" và tự vẽ lại mỗi khi nguồn đổi.
// getServerSnapshot trả null → lúc render trên SERVER chưa có giờ → hiện "--:--".
// Nhờ vậy HTML của server và lần render đầu ở trình duyệt GIỐNG NHAU → không lỗi hydration
// (nếu server tính giờ lúc 10:00:00 mà trình duyệt chạy lúc 10:00:01 → hai bên lệch chữ → React báo lỗi).
function subscribeEverySecond(onTick: () => void) {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
}
const nowInSeconds = () => Math.floor(Date.now() / 1000); // làm tròn giây → giá trị ỔN ĐỊNH giữa 2 lần React hỏi
function useNowSeconds(): number | null {
  return useSyncExternalStore(subscribeEverySecond, nowInSeconds, () => null);
}

export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const now = useNowSeconds();
  const left = now === null ? null : Math.max(Math.floor(new Date(expiresAt).getTime() / 1000) - now, 0);

  if (left === 0) {
    return (
      <p className="text-sm font-medium text-red-700">
        Đã hết thời gian giữ chỗ. Nếu bạn vừa chuyển khoản, đừng lo: khi tiền về, hệ thống sẽ tự xác nhận nếu buổi còn
        chỗ, hoặc hoàn tiền nếu đã hết.
      </p>
    );
  }
  return (
    <p className="text-sm text-stone-600">
      Giữ chỗ còn{" "}
      <span
        data-testid="hold-countdown"
        className={`font-mono text-lg font-bold ${left !== null && left < 300 ? "text-red-700" : "text-amber-700"}`}
      >
        {left === null ? "--:--" : formatClock(left)}
      </span>
    </p>
  );
}

// 1799 → "29:59";  5400 → "1:30:00" (giữ chỗ lâu hơn 1 giờ thì hiện cả giờ)
function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ── TỰ CẬP NHẬT KHI TIỀN VỀ ────────────────────────────────
// Cứ vài giây hỏi lại server (router.refresh = render lại Server Component với dữ liệu mới, KHÔNG tải lại cả trang).
// Webhook xác nhận đơn → lần refresh kế tiếp thấy CONFIRMED → trang đổi sang "Đã xác nhận", component này biến mất.
// Tab bị ẩn (khách chuyển sang app ngân hàng) → tạm dừng, khỏi tốn request; quay lại tab → hỏi NGAY.
export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(refresh, everyMs);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, everyMs]);
  return null;
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-md border border-stone-300 px-2 py-0.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
    >
      {copied ? "Đã chép ✓" : "Chép"}
    </button>
  );
}
