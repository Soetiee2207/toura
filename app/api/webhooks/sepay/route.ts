// POST /api/webhooks/sepay — SePay gọi vào đây mỗi khi tài khoản ngân hàng có biến động.
// Đây là endpoint CÔNG KHAI trên internet: ai cũng gửi được request → CHỈ tin request có chữ ký đúng.
//
// Quy ước trả lời của SePay: HTTP 200 + {"success": true} trong 30 giây = đã nhận.
// Trả lỗi (4xx/5xx) → SePay gửi lại tối đa 7 lần trong 5 giờ. Vì vậy:
//   - Lỗi tạm thời (DB mất kết nối...) → để văng lỗi 500 → SePay gửi lại → xử lý lại (transaction đã rollback).
//   - Webhook trùng → vẫn trả 200 (đã xử lý rồi, không cần gửi lại nữa).
import { processSepayTransfer } from "@/lib/payments";
import { sepayTransferSchema, verifySepaySignature } from "@/lib/sepay";

export async function POST(request: Request) {
  const secret = process.env.SEPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[sepay] Thiếu SEPAY_WEBHOOK_SECRET trong .env");
    return Response.json({ success: false }, { status: 500 });
  }

  // Đọc body NGUYÊN VĂN (text), KHÔNG dùng request.json(): chữ ký được tính trên đúng từng byte gửi tới
  const rawBody = await request.text();

  const valid = verifySepaySignature({
    secret,
    rawBody,
    signature: request.headers.get("x-sepay-signature"),
    timestamp: request.headers.get("x-sepay-timestamp"),
  });
  if (!valid) {
    // KHÔNG lưu request giả vào webhook_events: nếu lưu, kẻ gian có thể "chiếm trước" một mã giao dịch
    // (provider_event_id là UNIQUE) → webhook THẬT tới sau bị coi là trùng → mất ghi nhận tiền của khách.
    return Response.json({ success: false, error: "invalid signature" }, { status: 401 });
  }

  let transfer;
  try {
    transfer = sepayTransferSchema.parse(JSON.parse(rawBody));
  } catch {
    console.error("[sepay] Payload không đúng định dạng:", rawBody.slice(0, 500));
    return Response.json({ success: false, error: "invalid payload" }, { status: 400 });
  }

  const result = await processSepayTransfer(transfer);
  if (result.outcome === "UNMATCHED") {
    console.warn(`[sepay] Giao dịch ${transfer.id} không khớp đơn nào: "${transfer.content}"`);
  }
  return Response.json({ success: true, ...result });
}
