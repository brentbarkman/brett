-- DropIndex
DROP INDEX "GranolaAccount_userId_key";

-- CreateIndex
CREATE UNIQUE INDEX "GranolaAccount_userId_email_key" ON "GranolaAccount"("userId", "email");
