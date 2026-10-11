# Toura

Hệ thống đặt tour ngắn và trải nghiệm địa phương — MVP thương mại cho **một đơn vị tổ chức** trải nghiệm tại một địa phương, với luồng giao dịch đầu-cuối hoàn chỉnh.

> Trạng thái: 🚧 Đang khởi tạo (Bước 0 — thiết kế mô hình dữ liệu)

## Phạm vi MVP

**Website khách**
- Khám phá trải nghiệm, xem lịch và giá
- Chọn số người, đặt chỗ, thanh toán và nhận vé

**Trang quản lý**
- Tạo trải nghiệm, mở buổi tổ chức, thiết lập sức chứa
- Xử lý đơn, check-in, xem doanh thu

**Giới hạn**
- Chỉ tour/workshop trong ngày, giá cố định mỗi người, một đơn vị tổ chức
- Chưa làm: marketplace, chia hoa hồng, khách sạn, vé máy bay

## Mô hình nghiệp vụ

| Thực thể | Vai trò |
|---|---|
| **Experience** | Thông tin tour: mô tả, địa điểm, giá |
| **Session** | Một ngày/giờ cụ thể, sức chứa, trạng thái mở bán |
| **Booking** | Số vé, người mua, buổi được đặt, vòng đời đơn |
| **Payment** | Giao dịch, kết quả xác minh, hoàn tiền — tách riêng khỏi trạng thái booking |
| **Ticket / Attendee** | Mã vé và trạng thái check-in cho từng suất |

Một Experience có nhiều Session. **Số chỗ được tính theo từng Session.**

## Yêu cầu backend cốt lõi

- **Đặt đồng thời** — transaction + ràng buộc DB, không bán vượt số chỗ
- **Giữ chỗ có thời hạn** — tự giải phóng khi thanh toán không hoàn tất
- **Webhook thanh toán** — xác thực nguồn, xử lý idempotent
- **Hủy / hoàn tiền** — trạng thái booking & payment độc lập, có lịch sử và audit log
- **Phân quyền** khách / nhân viên / quản trị; validation; thông báo lỗi rõ ràng; test luồng quan trọng

## Lộ trình

- [ ] **Mốc 1 — Đặt chỗ thủ công:** danh mục trải nghiệm, buổi tổ chức, đơn đặt, trang quản trị, xác nhận thủ công
- [ ] **Mốc 2 — Giao dịch tự động:** giữ chỗ, cổng thanh toán (sandbox), xác minh webhook, hủy đơn, vé, check-in
- [ ] **Mốc 3 — Vận hành:** Docker, GitHub Actions, môi trường demo, log/giám sát, backup & restore, hướng dẫn triển khai

## Tiêu chí hoàn thành

- Khách đặt được vé từ đầu đến cuối
- Quản lý vận hành được buổi tổ chức
- Test cạnh tranh chỗ và webhook lặp đều đạt
- Hệ thống khôi phục được từ backup

## Tech stack

_Sẽ cập nhật._

## Cài đặt & chạy

_Sẽ cập nhật._
