-- CreateEnum
CREATE TYPE "SmsKind" AS ENUM ('OTP', 'OFFER_RECEIVED', 'ESCROW_FUNDED', 'COLLECTION_CODE', 'ALERT_MATCH', 'SYNDICATE_DEADLINE');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'REJECTED');

-- CreateTable
CREATE TABLE "sms_deliveries" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "kind" "SmsKind" NOT NULL,
    "status" "SmsStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "cost" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "failureText" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sms_deliveries_phone_createdAt_idx" ON "sms_deliveries"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "sms_deliveries_status_idx" ON "sms_deliveries"("status");
