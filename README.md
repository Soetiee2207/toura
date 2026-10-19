# Toura

Hệ thống đặt tour ngắn và trải nghiệm địa phương — MVP thương mại cho **một đơn vị tổ chức** trải nghiệm tại một địa phương, với luồng giao dịch đầu-cuối hoàn chỉnh.

> Trạng thái: ✅ **Mốc 1 hoàn thành** (đặt chỗ + xác nhận thủ công). Tiếp theo: Mốc 2 — thanh toán tự động, vé, check-in.

## Phạm vi MVP

**Website khách** (không cần tài khoản)
- Khám phá trải nghiệm, xem lịch và giá
- Chọn số người, đặt chỗ, nhận mã đơn để tra cứu

**Trang quản lý** (`/admin`)
- Nhân viên (STAFF): xem/tìm đơn, xác nhận, huỷ đơn đang giữ chỗ
- Quản trị (ADMIN): thêm quyền huỷ đơn đã xác nhận, quản lý trải nghiệm & buổi, xem doanh thu

**Giới hạn**
- Chỉ tour/workshop trong ngày, giá cố định mỗi người, một đơn vị tổ chức
- Chưa làm: marketplace, chia hoa hồng, khách sạn, vé máy bay

## Mô hình nghiệp vụ

| Thực thể | Vai trò |
|---|---|
| **Experience** | Thông tin tour: mô tả, điểm hẹn, giá mặc định. Không xoá — chỉ ẩn |
| **Session** | Một ngày/giờ cụ thể, sức chứa, giá, trạng thái mở bán. Không xoá — chỉ huỷ |
| **Booking** | Số người, liên hệ, giá chốt lúc đặt (snapshot), vòng đời đơn |
| **BookingStatusHistory** | Lịch sử chuyển trạng thái của đơn (chỉ thêm, không sửa) |
| **AuditLog** | Ai làm gì, lúc nào, thay đổi những gì — cho toàn hệ thống |
| **Payment / Ticket** | Đã có trong schema, dùng từ Mốc 2 |

Một Experience có nhiều Session. **Số chỗ được tính theo từng Session** (`capacity`, `seats_booked`).

### Máy trạng thái

```
Booking:  PENDING ──► CONFIRMED ──► CANCELLED
             │ └────────────────────► CANCELLED
             └──► EXPIRED  (job tự động, khi quá hạn giữ chỗ)

Session:  DRAFT ──► OPEN ⇄ CLOSED ──► CANCELLED (chỉ khi không còn chỗ nào được giữ)
```

## Tech stack

| Lớp | Công nghệ |
|---|---|
| Web | Next.js 16 (App Router, Server Components, Server Actions), React 19, Tailwind CSS 4 |
| Ngôn ngữ | TypeScript |
| Database | PostgreSQL 17 (Docker), Prisma ORM 7 (driver adapter `pg`) |
| Validation | zod 4 |
| Test | Vitest — chạy trên database thật (`toura_test`), không mock |
| Auth | Cookie phiên ký HMAC-SHA256, mật khẩu băm scrypt (không thư viện ngoài) |

## Cài đặt & chạy

Yêu cầu: Node.js 22+, Docker.

```bash
# 1. Cài thư viện
npm install

# 2. Tạo file cấu hình rồi điền giá trị thật (mật khẩu DB, AUTH_SECRET...)
cp .env.example .env
#    Tạo AUTH_SECRET ngẫu nhiên:
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 3. Bật PostgreSQL
docker compose up -d

# 4. Tạo bảng + dữ liệu mẫu
npx prisma migrate dev
npx prisma db seed

# 5. Chạy web → http://localhost:3000 (quản trị: /admin)
npm run dev
```

Tài khoản mẫu (chỉ môi trường dev, mật khẩu mặc định `toura123`, đổi bằng biến `SEED_USER_PASSWORD`):

| Email | Vai trò |
|---|---|
| `admin@toura.local` | ADMIN |
| `staff@toura.local` | STAFF |

### Job hết hạn giữ chỗ

Đơn PENDING quá `BOOKING_HOLD_MINUTES` sẽ chuyển sang EXPIRED và **trả chỗ** cho buổi. Việc này do một job riêng làm, không phải web:

```bash
npm run jobs:expire                 # chạy một lần (dùng với cron)
npm run jobs:expire -- --every 60   # chạy lặp mỗi 60 giây (tối thiểu 5), Ctrl+C để dừng
```

Job an toàn khi chạy lặp lại hoặc hai bản chạy chồng nhau (xem phần Kiến trúc).

### Test

Test chạy trên một database **riêng** để không đụng dữ liệu dev. Tạo một lần:

```bash
docker compose exec db createdb -U toura toura_test
# rồi đặt DATABASE_URL_TEST trong .env (xem .env.example)
```

```bash
npm test          # tự áp dụng migration lên toura_test rồi chạy toàn bộ test
npm run lint
npx tsc --noEmit
```

## Cấu trúc thư mục

```
app/
  page.tsx, experiences/[slug]/     Trang khách: danh sách, chi tiết trải nghiệm
  book/                             Form đặt chỗ (Server Action)
  bookings/[code]/                  Tra cứu đơn bằng mã
  admin/login/                      Đăng nhập nhân viên
  admin/(panel)/                    Khu quản trị (route group: dùng chung layout, không hiện trên URL)
    bookings/                       Danh sách, chi tiết, xác nhận/huỷ đơn
    experiences/                    Quản lý trải nghiệm & buổi (ADMIN)
    reports/                        Doanh thu theo tháng (ADMIN)
components/                         Component giao diện dùng chung
lib/                                TOÀN BỘ nghiệp vụ — không phụ thuộc giao diện, test trực tiếp được
  booking.ts                        Đặt chỗ (giữ chỗ nguyên tử, idempotency)
  booking-admin.ts                  Xác nhận / huỷ / hết hạn đơn + máy trạng thái
  catalog.ts, catalog-admin.ts      Đọc danh mục cho khách / quản lý danh mục cho admin
  reports.ts                        Báo cáo doanh thu
  auth.ts, session-token.ts, password.ts   Đăng nhập, phân quyền
  audit.ts                          Ghi audit log
  *-schema.ts                       Validation (zod) cho từng form
  format.ts                         Định dạng tiền, giờ Việt Nam
proxy.ts                            Chặn sớm /admin khi chưa đăng nhập (không phải lớp bảo vệ chính)
scripts/expire-bookings.ts          Job hết hạn giữ chỗ
prisma/                             Schema, migration (gồm CHECK constraint viết tay), seed
tests/                              Test nghiệp vụ trên DB thật
```

## Kiến trúc & quyết định chính

**1. Không bán vượt chỗ — điều kiện nằm trong câu UPDATE.**
Giữ chỗ là một câu `UPDATE sessions SET seats_booked = seats_booked + n WHERE seats_booked + n <= capacity` (`lib/booking.ts`). Postgres khoá dòng khi ghi → các request đồng thời xếp hàng, người sau luôn thấy kết quả người trước. Không có kiểu "đọc → so sánh trong JS → ghi" (sai khi hai người cùng đọc). DB còn có `CHECK (seats_booked <= capacity)` làm lưới an toàn cuối.
Cùng ý tưởng cho admin giảm sức chứa (`seatsBooked <= capacity mới`) và huỷ buổi (`seatsBooked = 0`) trong `lib/catalog-admin.ts`.

**2. Compare-and-set cho mọi chuyển trạng thái.**
`UPDATE ... WHERE id = ? AND status = <trạng thái vừa đọc>`; ghi được 0 dòng nghĩa là người khác đã đổi trước → báo xung đột, không ghi đè. Nhờ vậy hai nhân viên cùng bấm "Huỷ" thì chỗ chỉ được trả **một lần**, và job hết hạn không "đá" một đơn vừa được xác nhận.

**3. Idempotency key chống tạo đơn trùng.**
Form đặt chỗ gửi kèm một UUID; bấm lại / mạng chập chờn gửi lặp → ràng buộc UNIQUE của DB chặn, trả lại đúng đơn đã tạo.

**4. Lịch sử + audit log trong CÙNG transaction với thay đổi.**
Thay đổi thành công thì chắc chắn có dấu vết; thay đổi bị rollback thì dấu vết cũng biến mất. Audit log khi sửa chỉ ghi các trường **thực sự đổi** (`{ price: { from, to } }`).

**5. Phân quyền nhiều lớp — lớp chính nằm ở server.**
`proxy.ts` chỉ chặn sớm cho nhanh; mỗi trang và **mỗi Server Action** tự gọi `requireUser(roles)` (Server Action là endpoint POST công khai, gọi được mà không cần bấm nút). Ẩn nút/link trên giao diện chỉ để gọn, không phải bảo mật. Luật nghiệp vụ (vd: STAFF không huỷ được đơn đã xác nhận) nằm trong `lib/`, không nằm ở giao diện.

**6. Giá snapshot.** Đơn lưu `unit_price` lúc đặt → admin đổi giá buổi chỉ ảnh hưởng đơn mới.

**7. Giờ Việt Nam.** Mọi giờ nhân viên nhập được hiểu là UTC+7 (`parseVNDateTimeInput`), mọi giờ hiển thị đều ép múi giờ `Asia/Ho_Chi_Minh` → kết quả không phụ thuộc múi giờ máy chủ (Docker thường chạy UTC). Báo cáo tháng cũng cắt theo giờ VN.

**8. Không xoá dữ liệu nghiệp vụ.** Trải nghiệm thì ẩn, buổi thì huỷ, đơn thì chuyển trạng thái — giữ nguyên lịch sử.

### Test cạnh tranh

Các tình huống đồng thời (nhiều người đặt chỗ cuối, hai nhân viên cùng huỷ, admin giảm sức chứa đúng lúc khách đặt) được test **có kiểm soát**, không dựa vào may rủi: helper `raceOnRow` (`tests/helpers.ts`) giữ khoá dòng, đợi đến khi Postgres báo các request đều đang chờ khoá (`pg_stat_activity`) rồi mới thả. Chế độ `ordered` chọn được bên nào vào hàng trước → test được **cả hai thứ tự**.

## Lộ trình

- [x] **Mốc 1 — Đặt chỗ thủ công**
  - [x] Danh mục trải nghiệm & buổi cho khách
  - [x] Đặt chỗ không bán vượt, chống đơn trùng
  - [x] Đăng nhập nhân viên, phân quyền STAFF/ADMIN
  - [x] Xác nhận / huỷ đơn, lịch sử trạng thái, audit log
  - [x] Job hết hạn giữ chỗ
  - [x] Quản lý trải nghiệm & buổi
  - [x] Báo cáo doanh thu theo tháng
- [ ] **Mốc 2 — Giao dịch tự động:** cổng thanh toán (sandbox), xác minh webhook + idempotent, hoàn tiền, huỷ cả buổi, vé, check-in
- [ ] **Mốc 3 — Vận hành:** Docker cho app & job, GitHub Actions, môi trường demo, log/giám sát, backup & restore, hướng dẫn triển khai

## Tiêu chí hoàn thành

- Khách đặt được vé từ đầu đến cuối
- Quản lý vận hành được buổi tổ chức
- Test cạnh tranh chỗ và webhook lặp đều đạt
- Hệ thống khôi phục được từ backup
