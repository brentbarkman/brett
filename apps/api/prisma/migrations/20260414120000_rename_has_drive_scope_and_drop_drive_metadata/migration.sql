-- Rename GoogleAccount.hasDriveScope → hasMeetingNotesScope.
-- The column previously tracked whether both drive.metadata.readonly and documents.readonly
-- scopes were granted. We're dropping the restricted drive.metadata.readonly scope (it blocks
-- publishing without CASA audit). The column now tracks only documents.readonly — which is
-- all we need since Calendar event.attachments[] provides the fileId directly.
ALTER TABLE "GoogleAccount" RENAME COLUMN "hasDriveScope" TO "hasMeetingNotesScope";
