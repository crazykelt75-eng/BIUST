-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "RestrictionKind" AS ENUM ('FMD_OUTBREAK', 'QUARANTINE', 'ADMINISTRATIVE');

-- CreateEnum
CREATE TYPE "MovementDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('TN', 'EN');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('FARMER', 'BUTCHER', 'FEEDLOT', 'TRANSPORTER', 'VET_OFFICER', 'AUCTIONEER', 'ADMIN', 'TRUST_OFFICER');

-- CreateEnum
CREATE TYPE "VerificationTier" AS ENUM ('T0_UNVERIFIED', 'T1_IDENTIFIED', 'T2_VERIFIED_FARMER', 'T3_TRUSTED_TRADER', 'TB_VERIFIED_BUTCHER', 'TT_VERIFIED_TRANSPORTER');

-- CreateEnum
CREATE TYPE "VerificationKind" AS ENUM ('NATIONAL_ID', 'SELFIE_MATCH', 'FARM_REGISTRATION', 'BRAND_MARK', 'POLICE_CLEARANCE', 'BUSINESS_REGISTRATION', 'ABATTOIR_LICENCE', 'TRANSPORT_PERMIT', 'VEHICLE_REGISTRATION');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ListingCategory" AS ENUM ('CATTLE', 'SMALL_STOCK', 'POULTRY', 'PIGS', 'BREEDING_SERVICE', 'FEED_FODDER', 'CROPS_PRODUCE', 'BY_PRODUCTS', 'EQUIPMENT', 'GRAZING_LEASE');

-- CreateEnum
CREATE TYPE "SaleMechanism" AS ENUM ('FIXED_PRICE', 'BEST_OFFER', 'SEALED_BID_TENDER', 'TIMED_AUCTION', 'GROUP_BUY');

-- CreateEnum
CREATE TYPE "PriceBasis" AS ENUM ('PER_HEAD', 'PER_KG_LIVE', 'PER_KG_CARCASS', 'PER_LOT');

-- CreateEnum
CREATE TYPE "CollectionTerms" AS ENUM ('BUYER_COLLECTS', 'SELLER_DELIVERS', 'NEGOTIABLE');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'PARTIALLY_COMMITTED', 'FULLY_COMMITTED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CattleBreed" AS ENUM ('TSWANA', 'BRAHMAN', 'SIMMENTAL', 'BONSMARA', 'AFRIKANER', 'COMPOSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "AnimalSex" AS ENUM ('BULL', 'COW', 'OX', 'HEIFER', 'WEANER_MALE', 'WEANER_FEMALE', 'CALF');

-- CreateEnum
CREATE TYPE "WeightMethod" AS ENUM ('WEIGHBRIDGE', 'SCALE', 'TAPE_ESTIMATE', 'VISUAL_ESTIMATE');

-- CreateEnum
CREATE TYPE "HornStatus" AS ENUM ('HORNED', 'POLLED', 'DEHORNED');

-- CreateEnum
CREATE TYPE "PregnancyStatus" AS ENUM ('OPEN', 'PREGNANT', 'LACTATING', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "Temperament" AS ENUM ('DOCILE', 'AVERAGE', 'WILD');

-- CreateEnum
CREATE TYPE "HealthEventKind" AS ENUM ('VACCINATION', 'DIPPING', 'TREATMENT', 'INSPECTION');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PHOTO', 'VIDEO', 'DOCUMENT', 'VOICE_NOTE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'SMS', 'WHATSAPP', 'EMAIL', 'IN_APP', 'USSD');

-- CreateEnum
CREATE TYPE "AlertUrgency" AS ENUM ('INSTANT', 'HOURLY_DIGEST', 'DAILY_DIGEST');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED_RATE_LIMIT', 'SUPPRESSED_QUIET_HOURS', 'SUPPRESSED_DUPLICATE');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'COUNTERED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TransactionState" AS ENUM ('OFFER_MADE', 'OFFER_ACCEPTED', 'ESCROW_PENDING', 'ESCROW_FUNDED', 'PERMIT_PENDING', 'READY_FOR_COLLECTION', 'IN_TRANSIT', 'DELIVERED', 'INSPECTION_WINDOW', 'SETTLED', 'DISPUTED', 'RESOLVED', 'REVERSED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FundClass" AS ENUM ('CLIENT_TRUST', 'PLATFORM_OPERATING');

-- CreateEnum
CREATE TYPE "LedgerEvent" AS ENUM ('DEPOSIT_RECEIVED', 'DEPOSIT_CONFIRMED', 'ESCROW_FUNDED', 'SETTLEMENT', 'FEE_SWEEP', 'PAYOUT_EXECUTED', 'REFUND_ISSUED', 'PARTIAL_REFUND', 'DISPUTE_HOLD', 'DISPUTE_RELEASE', 'SYNDICATE_PLEDGE_FUNDED', 'SYNDICATE_LAPSED', 'DEFAULT_DEPOSIT_FORFEITED', 'CORRECTION');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ORANGE_MONEY', 'MYZAKA', 'BANK_EFT', 'CASH_DEPOSIT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'AWAITING_AUTHORISATION', 'AUTHORISED', 'EXECUTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('BALANCED', 'VARIANCE_DETECTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DisputeReason" AS ENUM ('WEIGHT_MISMATCH', 'CONDITION_MISMATCH', 'ANIMAL_NOT_AS_DESCRIBED', 'NON_DELIVERY', 'NON_PAYMENT', 'LITS_MISMATCH', 'SUSPECTED_STOLEN', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED_BUYER', 'RESOLVED_SELLER', 'RESOLVED_SPLIT', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "StolenReportStatus" AS ENUM ('ACTIVE', 'RECOVERED', 'WITHDRAWN', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "FraudFlagKind" AS ENUM ('DUPLICATE_LITS_ID', 'STOLEN_LITS_ID', 'PRICE_FAR_BELOW_INDEX', 'IMAGE_REUSE', 'EXIF_LOCATION_MISMATCH', 'OFF_PLATFORM_CONTACT', 'LISTING_VELOCITY', 'DISPUTE_PATTERN', 'NEW_ACCOUNT_HIGH_VALUE');

-- CreateEnum
CREATE TYPE "FlagSeverity" AS ENUM ('HARD', 'SOFT');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('OPEN', 'CONFIRMED', 'DISMISSED');

-- CreateTable
CREATE TABLE "zones" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "boundary" geography(MultiPolygon, 4326),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_restrictions" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "kind" "RestrictionKind" NOT NULL,
    "direction" "MovementDirection",
    "reason" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "liftedAt" TIMESTAMP(3),
    "declaredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zone_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneVerifiedAt" TIMESTAMP(3),
    "email" TEXT,
    "fullName" TEXT,
    "preferredLocale" "Locale" NOT NULL DEFAULT 'TN',
    "tier" "VerificationTier" NOT NULL DEFAULT 'T0_UNVERIFIED',
    "roles" "UserRole"[],
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "VerificationKind" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "documentUrl" TEXT,
    "documentRefHash" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farms" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zoneId" TEXT,
    "location" geography(Point, 4326),
    "publicLocation" geography(Point, 4326),
    "district" TEXT,
    "brandMarkUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "zoneId" TEXT,
    "category" "ListingCategory" NOT NULL DEFAULT 'CATTLE',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "voiceNoteUrl" TEXT,
    "saleMechanism" "SaleMechanism" NOT NULL DEFAULT 'BEST_OFFER',
    "priceBasis" "PriceBasis" NOT NULL,
    "askingPrice" BIGINT NOT NULL,
    "priceNegotiable" BOOLEAN NOT NULL DEFAULT true,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "lotSplittable" BOOLEAN NOT NULL DEFAULT false,
    "minPurchaseQty" INTEGER NOT NULL DEFAULT 1,
    "availableFrom" TIMESTAMP(3),
    "availableUntil" TIMESTAMP(3),
    "collectionTerms" "CollectionTerms" NOT NULL DEFAULT 'BUYER_COLLECTS',
    "inspectionWelcome" BOOLEAN NOT NULL DEFAULT true,
    "attributes" JSONB,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "sellerTierAtPublish" "VerificationTier",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animals" (
    "id" TEXT NOT NULL,
    "listingId" TEXT,
    "litsId" TEXT NOT NULL,
    "brandMarkUrl" TEXT,
    "breed" "CattleBreed",
    "sex" "AnimalSex" NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "estimatedAgeMonths" INTEGER,
    "dentition" INTEGER,
    "weightKg" INTEGER,
    "weightMethod" "WeightMethod",
    "weighedAt" TIMESTAMP(3),
    "bodyCondition" INTEGER,
    "hornStatus" "HornStatus",
    "pregnancyStatus" "PregnancyStatus",
    "pregnancyMonths" INTEGER,
    "lastDipDate" TIMESTAMP(3),
    "temperament" "Temperament",
    "sireLitsId" TEXT,
    "damLitsId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "animals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_health_events" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "kind" "HealthEventKind" NOT NULL,
    "name" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "batchNumber" TEXT,
    "administeredBy" TEXT,
    "documentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "animal_health_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_media" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "url" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3),
    "capturedLocation" geography(Point, 4326),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categories" "ListingCategory"[],
    "breeds" "CattleBreed"[],
    "sexes" "AnimalSex"[],
    "minAgeMonths" INTEGER,
    "maxAgeMonths" INTEGER,
    "minWeightKg" INTEGER,
    "maxWeightKg" INTEGER,
    "maxPrice" BIGINT,
    "priceBasis" "PriceBasis",
    "centerPoint" geography(Point, 4326),
    "radiusKm" INTEGER NOT NULL DEFAULT 150,
    "zonesAllowed" TEXT[],
    "minSellerTier" "VerificationTier",
    "minSellerRating" DOUBLE PRECISION,
    "keywords" TEXT[],
    "channels" "NotificationChannel"[],
    "urgency" "AlertUrgency" NOT NULL DEFAULT 'INSTANT',
    "quietHoursStart" INTEGER NOT NULL DEFAULT 21,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 6,
    "activeFrom" TIMESTAMP(3),
    "activeUntil" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_sends" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "matchScore" DOUBLE PRECISION NOT NULL,
    "status" "SendStatus" NOT NULL DEFAULT 'QUEUED',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "convertedOfferId" TEXT,
    "failureReason" TEXT,

    CONSTRAINT "alert_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "message" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "parentOfferId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "offerId" TEXT,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "state" "TransactionState" NOT NULL DEFAULT 'OFFER_MADE',
    "agreedAmount" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceBasis" "PriceBasis" NOT NULL,
    "declaredWeightKg" INTEGER,
    "actualWeightKg" INTEGER,
    "weightTolerancePct" INTEGER NOT NULL DEFAULT 5,
    "settledAmount" BIGINT,
    "platformFee" BIGINT,
    "permitRequired" BOOLEAN NOT NULL DEFAULT false,
    "permitNumber" TEXT,
    "permitDocumentUrl" TEXT,
    "permitApprovedAt" TIMESTAMP(3),
    "collectionCodeHash" TEXT,
    "collectedAt" TIMESTAMP(3),
    "stateDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_events" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "fromState" "TransactionState",
    "toState" "TransactionState" NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "event" "LedgerEvent" NOT NULL,
    "transactionId" TEXT,
    "narrative" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedBy" TEXT,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "fundClass" "FundClass" NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT,
    "payerId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "externalRef" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "authorisedBy" TEXT,
    "coAuthorisedBy" TEXT,
    "batchId" TEXT,
    "externalRef" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "ledgerBalance" BIGINT NOT NULL,
    "bankBalance" BIGINT NOT NULL,
    "variance" BIGINT NOT NULL,
    "status" "ReconciliationStatus" NOT NULL,
    "payoutsFrozen" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "accuracyOfDescription" INTEGER NOT NULL,
    "communication" INTEGER NOT NULL,
    "punctuality" INTEGER NOT NULL,
    "conditionAsDescribed" INTEGER,
    "comment" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "reason" "DisputeReason" NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceUrls" TEXT[],
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "heldAmount" BIGINT,
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stolen_stock_reports" (
    "id" TEXT NOT NULL,
    "litsId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "policeCaseNumber" TEXT,
    "reportedStolenAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "status" "StolenReportStatus" NOT NULL DEFAULT 'ACTIVE',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stolen_stock_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_flags" (
    "id" TEXT NOT NULL,
    "kind" "FraudFlagKind" NOT NULL,
    "severity" "FlagSeverity" NOT NULL,
    "userId" TEXT,
    "listingId" TEXT,
    "litsId" TEXT,
    "detail" TEXT NOT NULL,
    "autoFrozen" BOOLEAN NOT NULL DEFAULT false,
    "status" "FlagStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zones_code_key" ON "zones"("code");

-- CreateIndex
CREATE INDEX "zone_restrictions_zoneId_liftedAt_idx" ON "zone_restrictions"("zoneId", "liftedAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tier_idx" ON "users"("tier");

-- CreateIndex
CREATE INDEX "verifications_userId_kind_idx" ON "verifications"("userId", "kind");

-- CreateIndex
CREATE INDEX "verifications_status_idx" ON "verifications"("status");

-- CreateIndex
CREATE INDEX "farms_ownerId_idx" ON "farms"("ownerId");

-- CreateIndex
CREATE INDEX "farms_zoneId_idx" ON "farms"("zoneId");

-- CreateIndex
CREATE INDEX "listings_status_publishedAt_idx" ON "listings"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "listings_category_status_idx" ON "listings"("category", "status");

-- CreateIndex
CREATE INDEX "listings_sellerId_idx" ON "listings"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "animals_litsId_key" ON "animals"("litsId");

-- CreateIndex
CREATE INDEX "animals_listingId_idx" ON "animals"("listingId");

-- CreateIndex
CREATE INDEX "animal_health_events_animalId_idx" ON "animal_health_events"("animalId");

-- CreateIndex
CREATE INDEX "listing_media_listingId_position_idx" ON "listing_media"("listingId", "position");

-- CreateIndex
CREATE INDEX "alert_profiles_userId_idx" ON "alert_profiles"("userId");

-- CreateIndex
CREATE INDEX "alert_profiles_enabled_idx" ON "alert_profiles"("enabled");

-- CreateIndex
CREATE INDEX "alert_sends_userId_queuedAt_idx" ON "alert_sends"("userId", "queuedAt");

-- CreateIndex
CREATE INDEX "alert_sends_status_idx" ON "alert_sends"("status");

-- CreateIndex
CREATE UNIQUE INDEX "alert_sends_profileId_listingId_channel_key" ON "alert_sends"("profileId", "listingId", "channel");

-- CreateIndex
CREATE INDEX "offers_listingId_status_idx" ON "offers"("listingId", "status");

-- CreateIndex
CREATE INDEX "offers_buyerId_idx" ON "offers"("buyerId");

-- CreateIndex
CREATE INDEX "offers_status_expiresAt_idx" ON "offers"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_offerId_key" ON "transactions"("offerId");

-- CreateIndex
CREATE INDEX "transactions_state_stateDeadline_idx" ON "transactions"("state", "stateDeadline");

-- CreateIndex
CREATE INDEX "transactions_buyerId_idx" ON "transactions"("buyerId");

-- CreateIndex
CREATE INDEX "transactions_sellerId_idx" ON "transactions"("sellerId");

-- CreateIndex
CREATE INDEX "transaction_events_transactionId_occurredAt_idx" ON "transaction_events"("transactionId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_eventKey_key" ON "journal_entries"("eventKey");

-- CreateIndex
CREATE INDEX "journal_entries_event_occurredAt_idx" ON "journal_entries"("event", "occurredAt");

-- CreateIndex
CREATE INDEX "journal_entries_transactionId_idx" ON "journal_entries"("transactionId");

-- CreateIndex
CREATE INDEX "journal_lines_account_idx" ON "journal_lines"("account");

-- CreateIndex
CREATE INDEX "journal_lines_entryId_idx" ON "journal_lines"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_externalRef_key" ON "payments"("externalRef");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_transactionId_idx" ON "payments"("transactionId");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- CreateIndex
CREATE INDEX "payouts_batchId_idx" ON "payouts"("batchId");

-- CreateIndex
CREATE INDEX "payouts_payeeId_idx" ON "payouts"("payeeId");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_runs_asOfDate_key" ON "reconciliation_runs"("asOfDate");

-- CreateIndex
CREATE INDEX "ratings_subjectId_releasedAt_idx" ON "ratings"("subjectId", "releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_transactionId_authorId_key" ON "ratings"("transactionId", "authorId");

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "disputes"("status");

-- CreateIndex
CREATE INDEX "disputes_transactionId_idx" ON "disputes"("transactionId");

-- CreateIndex
CREATE INDEX "stolen_stock_reports_litsId_status_idx" ON "stolen_stock_reports"("litsId", "status");

-- CreateIndex
CREATE INDEX "fraud_flags_status_severity_idx" ON "fraud_flags"("status", "severity");

-- CreateIndex
CREATE INDEX "fraud_flags_litsId_idx" ON "fraud_flags"("litsId");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_idx" ON "audit_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_actorId_occurredAt_idx" ON "audit_log"("actorId", "occurredAt");

-- AddForeignKey
ALTER TABLE "zone_restrictions" ADD CONSTRAINT "zone_restrictions_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_health_events" ADD CONSTRAINT "animal_health_events_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_media" ADD CONSTRAINT "listing_media_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_profiles" ADD CONSTRAINT "alert_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_sends" ADD CONSTRAINT "alert_sends_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "alert_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_sends" ADD CONSTRAINT "alert_sends_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_sends" ADD CONSTRAINT "alert_sends_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_parentOfferId_fkey" FOREIGN KEY ("parentOfferId") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_events" ADD CONSTRAINT "transaction_events_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stolen_stock_reports" ADD CONSTRAINT "stolen_stock_reports_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only enforcement for the evidence tables.
--
-- MASTER_PROMPT.md §10.3: transaction_events, journal_entries, journal_lines and
-- audit_log are append-only. Livestock disputes reach real arbitration and
-- sometimes court, and an immutable log is the evidence. A ledger you can
-- UPDATE is not a ledger, it is a spreadsheet with extra steps.
--
-- Enforced in the database rather than only in application code, because the
-- application is not the only thing that will ever hold a connection to this
-- database. Corrections are new reversing entries (see events.ts `correction`),
-- never edits.
--
-- Apply this as part of the initial migration:
--   npx prisma migrate dev --create-only --name init
--   cat prisma/sql/append_only.sql >> prisma/migrations/<timestamp>_init/migration.sql
--   npx prisma migrate dev

CREATE OR REPLACE FUNCTION kraal_forbid_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only. % is not permitted. Post a reversing entry instead.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'transaction_events',
    'journal_entries',
    'journal_lines',
    'audit_log'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_append_only
         BEFORE UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION kraal_forbid_mutation()',
      t, t
    );
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ledger balance constraint.
--
-- The application validates that every journal entry balances (journal.ts
-- buildEntry), and validates it twice — overall and within each fund class.
-- This is the backstop for anything that reaches the database by another route.

CREATE OR REPLACE FUNCTION kraal_assert_entry_balances()
RETURNS TRIGGER AS $$
DECLARE
  total bigint;
  line_count int;
BEGIN
  SELECT COALESCE(SUM(amount), 0), COUNT(*)
    INTO total, line_count
    FROM journal_lines
   WHERE "entryId" = NEW."entryId";

  IF line_count >= 2 AND total <> 0 THEN
    RAISE EXCEPTION
      'Journal entry % does not balance: lines sum to %, expected 0',
      NEW."entryId", total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DEFERRABLE so a multi-line entry can be inserted line by line inside one
-- transaction and is only checked at COMMIT.
CREATE CONSTRAINT TRIGGER journal_lines_balance
  AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kraal_assert_entry_balances();

-- ─────────────────────────────────────────────────────────────────────────────
-- Trust account may never be overdrawn.
--
-- A negative trust cash balance means client money has been paid out that was
-- never received. There is no legitimate state in which this is correct.

CREATE OR REPLACE FUNCTION kraal_assert_trust_not_overdrawn()
RETURNS TRIGGER AS $$
DECLARE
  trust_balance bigint;
BEGIN
  SELECT COALESCE(SUM(amount), 0)
    INTO trust_balance
    FROM journal_lines
   WHERE account = 'bank:trust';

  IF trust_balance < 0 THEN
    RAISE EXCEPTION
      'Trust account would be overdrawn (balance %). Client funds cannot go negative.',
      trust_balance
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_lines_trust_not_overdrawn
  AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kraal_assert_trust_not_overdrawn();
