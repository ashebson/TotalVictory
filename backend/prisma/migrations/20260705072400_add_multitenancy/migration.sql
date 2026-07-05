-- DropIndex
DROP INDEX "Caller_phone_key";

-- AlterTable
ALTER TABLE "Admin" ALTER COLUMN "id" DROP DEFAULT;
DROP SEQUENCE "Admin_id_seq";

-- AlterTable
ALTER TABLE "CallLog" ALTER COLUMN "id" DROP DEFAULT;
DROP SEQUENCE "CallLog_id_seq";

-- AlterTable
ALTER TABLE "Caller" ADD COLUMN     "adminId" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "id" DROP DEFAULT;
DROP SEQUENCE "Caller_id_seq";

-- AlterTable
ALTER TABLE "Contact" ALTER COLUMN "id" DROP DEFAULT;
DROP SEQUENCE "Contact_id_seq";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "adminId" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "id" DROP DEFAULT;
DROP SEQUENCE "Project_id_seq";

-- AlterTable
ALTER TABLE "Setting" DROP CONSTRAINT "Setting_pkey",
ADD COLUMN     "adminId" INTEGER NOT NULL DEFAULT 1,
ADD CONSTRAINT "Setting_pkey" PRIMARY KEY ("adminId", "key");

-- AlterTable
ALTER TABLE "Subscription" ALTER COLUMN "id" DROP DEFAULT;
DROP SEQUENCE "Subscription_id_seq";

-- CreateIndex
CREATE UNIQUE INDEX "Caller_adminId_phone_key" ON "Caller"("adminId", "phone");

-- CreateIndex
CREATE INDEX "Project_adminId_idx" ON "Project"("adminId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caller" ADD CONSTRAINT "Caller_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "Contact_project_status_lastCalledAt_idx" RENAME TO "Contact_projectId_status_lastCalledAt_idx";
