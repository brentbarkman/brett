-- Add keyPrefix column for stable, human-readable masking of AI provider keys.
-- Existing rows stay null and render as a generic mask; newly-saved keys
-- capture the first 6 chars of the plaintext at encryption time.
ALTER TABLE "UserAIConfig" ADD COLUMN "keyPrefix" TEXT;
