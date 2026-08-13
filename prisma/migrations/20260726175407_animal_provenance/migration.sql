/*
  Warnings:

  - You are about to drop the column `listingId` on the `animals` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "animals" DROP CONSTRAINT "animals_listingId_fkey";

-- DropIndex
DROP INDEX "animals_listingId_idx";

-- AlterTable
ALTER TABLE "animals" DROP COLUMN "listingId",
ADD COLUMN     "currentOwnerId" TEXT,
ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "listing_animals" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "claimedByTransactionId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "listing_animals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_transfers" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT NOT NULL,
    "transactionId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "animal_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_animals_animalId_idx" ON "listing_animals"("animalId");

-- CreateIndex
CREATE UNIQUE INDEX "listing_animals_listingId_animalId_key" ON "listing_animals"("listingId", "animalId");

-- CreateIndex
CREATE INDEX "animal_transfers_animalId_occurredAt_idx" ON "animal_transfers"("animalId", "occurredAt");

-- CreateIndex
CREATE INDEX "animal_transfers_toUserId_idx" ON "animal_transfers"("toUserId");

-- CreateIndex
CREATE INDEX "animals_currentOwnerId_idx" ON "animals"("currentOwnerId");

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_currentOwnerId_fkey" FOREIGN KEY ("currentOwnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_animals" ADD CONSTRAINT "listing_animals_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_animals" ADD CONSTRAINT "listing_animals_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_transfers" ADD CONSTRAINT "animal_transfers_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
