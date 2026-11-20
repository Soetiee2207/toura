// GIẢ LẬP SEPAY trên máy dev: tạo một giao dịch "tiền vào", KÝ y hệt SePay (HMAC-SHA256 bằng SEPAY_WEBHOOK_SECRET)
// rồi gửi vào webhook của app đang chạy. Không cần internet, không cần chuyển tiền thật.
//
//   npm run sepay:simulate -- TRA-7X3K9A                 → chuyển ĐÚNG số tiền còn thiếu của đơn
//   npm run sepay:simulate -- TRA-7X3K9A --amount 50000  → chuyển thiếu / thừa tuỳ ý
//   npm run sepay:simulate -- TRA-7X3K9A --id 123        → gửi lại cùng mã giao dịch (thử chống trùng)
//   npm run sepay:simulate -- --content "chuyen tien"    → nội dung không có mã đơn (thử UNMATCHED)
//   npm run sepay:simulate -- TRA-7X3K9A --bad-signature → chữ ký sai (phải bị từ chối 401)
//   --url http://localhost:3000                          → địa chỉ app (mặc định như bên trái)
import "dotenv/config";
import { parseArgs } from "node:util";
import { getBookingByCode } from "../lib/booking";
import { prisma } from "../lib/prisma";
import { type SepayTransfer, signSepayBody, transferContentFor } from "../lib/sepay";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      amount: { type: "string" },
      id: { type: "string" },
      content: { type: "string" },
      url: { type: "string", default: "http://localhost:3000" },
      "bad-signature": { type: "boolean", default: false },
    },
  });
  const code = positionals[0]?.toUpperCase();
  if (!code && !values.content) throw new Error("Cần mã đơn (vd TRA-7X3K9A) hoặc --content");

  const secret = process.env.SEPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error("Thiếu SEPAY_WEBHOOK_SECRET trong .env");

  let amount = values.amount ? Number(values.amount) : undefined;
  if (amount === undefined) {
    if (!code) throw new Error("Không có mã đơn → cần --amount");
    const booking = await getBookingByCode(code);
    if (!booking) throw new Error(`Không tìm thấy đơn ${code}`);
    amount = booking.amountDue || booking.totalAmount; // đơn đã đủ tiền → chuyển nguyên giá (thử "chuyển 2 lần")
  }
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("--amount phải là số nguyên dương");

  // Giống dữ liệu SePay thật: ngân hàng hay chèn thêm chữ quanh nội dung khách gõ
  const transfer: SepayTransfer = {
    id: values.id ? Number(values.id) : Date.now() % 2_000_000_000, // mỗi lần chạy 1 mã giao dịch mới
    gateway: process.env.SEPAY_BANK_CODE ?? "MBBank",
    transactionDate: new Date().toISOString().slice(0, 19).replace("T", " "),
    accountNumber: process.env.SEPAY_BANK_ACCOUNT ?? "0123456789",
    code: null,
    content: values.content ?? `MBVCB.${Math.floor(Math.random() * 1e6)}.${transferContentFor(code!)}.CT tu 0901234567`,
    transferType: "in",
    transferAmount: amount,
    referenceCode: `FT${Date.now()}`,
  };

  const rawBody = JSON.stringify(transfer);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signSepayBody(values["bad-signature"] ? "sai-secret" : secret, timestamp, rawBody);

  console.log(`→ Gửi giao dịch #${transfer.id}: ${amount.toLocaleString("vi-VN")}đ, nội dung "${transfer.content}"`);
  const res = await fetch(`${values.url}/api/webhooks/sepay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SePay-Signature": signature,
      "X-SePay-Timestamp": String(timestamp),
    },
    body: rawBody,
  });
  console.log(`← HTTP ${res.status}`, await res.text());
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
