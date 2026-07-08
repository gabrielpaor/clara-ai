-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN     "costUsd" DECIMAL(10,6),
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "promptTokens" INTEGER;
