-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('VALID', 'CHECKED_IN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('CUSTOMER', 'STAFF', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiences" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "meeting_point" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "default_price" INTEGER NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "experience_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "capacity" INTEGER NOT NULL,
    "seats_booked" INTEGER NOT NULL DEFAULT 0,
    "price" INTEGER NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "cancelled_by" "ActorType",
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "from_status" "BookingStatus",
    "to_status" "BookingStatus" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_txn_id" TEXT,
    "amount" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT,
    "paid_at" TIMESTAMPTZ,
    "refund_amount" INTEGER,
    "refund_reason" TEXT,
    "provider_refund_id" TEXT,
    "refunded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "attendee_name" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'VALID',
    "checked_in_at" TIMESTAMPTZ,
    "checked_in_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "experiences_slug_key" ON "experiences"("slug");

-- CreateIndex
CREATE INDEX "sessions_experience_id_starts_at_idx" ON "sessions"("experience_id", "starts_at");

-- CreateIndex
CREATE INDEX "sessions_status_starts_at_idx" ON "sessions"("status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_code_key" ON "bookings"("code");

-- CreateIndex
CREATE INDEX "bookings_session_id_status_idx" ON "bookings"("session_id", "status");

-- CreateIndex
CREATE INDEX "bookings_status_expires_at_idx" ON "bookings"("status", "expires_at");

-- CreateIndex
CREATE INDEX "bookings_contact_email_idx" ON "bookings"("contact_email");

-- CreateIndex
CREATE INDEX "booking_status_history_booking_id_created_at_idx" ON "booking_status_history"("booking_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_txn_id_key" ON "payments"("provider_txn_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_refund_id_key" ON "payments"("provider_refund_id");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_code_key" ON "tickets"("code");

-- CreateIndex
CREATE INDEX "tickets_booking_id_idx" ON "tickets"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_provider_event_id_key" ON "webhook_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_checked_in_by_fkey" FOREIGN KEY ("checked_in_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Ràng buộc viết tay (Prisma schema không biểu diễn được)
-- Đây là lớp bảo vệ cuối cùng: code có bug thì database vẫn từ chối dữ liệu sai.
-- ─────────────────────────────────────────────────────────────

-- Experience
ALTER TABLE "experiences"
  ADD CONSTRAINT "experiences_default_price_check"    CHECK ("default_price" >= 0),
  ADD CONSTRAINT "experiences_duration_minutes_check" CHECK ("duration_minutes" > 0);

-- Session: chống bán vượt số chỗ
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_capacity_check"     CHECK ("capacity" > 0),
  ADD CONSTRAINT "sessions_price_check"        CHECK ("price" >= 0),
  ADD CONSTRAINT "sessions_seats_booked_check" CHECK ("seats_booked" >= 0 AND "seats_booked" <= "capacity");

-- Booking: số vé dương, tổng tiền khớp với snapshot giá
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_quantity_check"     CHECK ("quantity" > 0),
  ADD CONSTRAINT "bookings_unit_price_check"   CHECK ("unit_price" >= 0),
  ADD CONSTRAINT "bookings_total_amount_check" CHECK ("total_amount" = "unit_price" * "quantity");

-- Payment: số tiền hợp lệ, hoàn không vượt quá số đã trả
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check"        CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_refund_amount_check" CHECK ("refund_amount" IS NULL OR ("refund_amount" > 0 AND "refund_amount" <= "amount"));

-- Mỗi booking chỉ có tối đa 1 payment "đã thu tiền" (kể cả khi sau đó đang/đã hoàn)
-- → partial unique index: chỉ áp UNIQUE cho các dòng thỏa điều kiện WHERE
CREATE UNIQUE INDEX "payments_one_captured_per_booking"
  ON "payments" ("booking_id")
  WHERE "status" IN ('SUCCEEDED', 'REFUND_PENDING', 'REFUNDED');
