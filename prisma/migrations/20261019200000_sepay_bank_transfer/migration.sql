-- Mốc 2: thanh toán bằng CHUYỂN KHOẢN qua SePay.

-- Ghi lại kết quả xử lý mỗi webhook (để admin tra cứu: khoản nào khớp đơn, khoản nào không)
ALTER TABLE "webhook_events" ADD COLUMN     "outcome" TEXT;

-- Bỏ ràng buộc "mỗi đơn tối đa 1 khoản đã thu" (thiết kế cho cổng thẻ).
-- Với chuyển khoản, khách có thể chuyển thiếu rồi chuyển bù, hoặc lỡ chuyển 2 lần: tiền ĐÃ vào tài khoản,
-- hệ thống không thể từ chối — phải GHI NHẬN được để còn hoàn lại. Chống xử lý trùng một giao dịch
-- vẫn được đảm bảo bởi UNIQUE trên payments.provider_txn_id và webhook_events(provider, provider_event_id).
DROP INDEX "payments_one_captured_per_booking";
