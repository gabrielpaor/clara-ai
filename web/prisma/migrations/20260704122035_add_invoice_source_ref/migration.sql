-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "sourceRef" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_sourceRef_idx" ON "Invoice"("sourceRef");
