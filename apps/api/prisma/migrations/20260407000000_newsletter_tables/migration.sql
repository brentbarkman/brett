-- CreateTable
CREATE TABLE "NewsletterSender" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterSender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingNewsletter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "textBody" TEXT,
    "postmarkMessageId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "approvalItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingNewsletter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSender_userId_email_key" ON "NewsletterSender"("userId", "email");

-- CreateIndex
CREATE INDEX "NewsletterSender_userId_idx" ON "NewsletterSender"("userId");

-- CreateIndex
CREATE INDEX "PendingNewsletter_userId_senderEmail_idx" ON "PendingNewsletter"("userId", "senderEmail");

-- CreateIndex
CREATE INDEX "PendingNewsletter_postmarkMessageId_idx" ON "PendingNewsletter"("postmarkMessageId");

-- AddForeignKey
ALTER TABLE "NewsletterSender" ADD CONSTRAINT "NewsletterSender_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingNewsletter" ADD CONSTRAINT "PendingNewsletter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
