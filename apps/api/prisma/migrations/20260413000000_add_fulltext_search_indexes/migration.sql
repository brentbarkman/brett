-- Add tsvector columns and GIN indexes for full-text search
-- These are generated columns that auto-update when source columns change

-- Items: search across title, notes, description, contentTitle
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("contentTitle", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'C') ||
    setweight(to_tsvector('english', coalesce("notes", '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS "Item_search_vector_idx" ON "Item" USING GIN ("search_vector");

-- Calendar events: title, description, location
ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'C') ||
    setweight(to_tsvector('english', coalesce("location", '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS "CalendarEvent_search_vector_idx" ON "CalendarEvent" USING GIN ("search_vector");

-- Meeting notes: title, summary (model MeetingNote maps to table GranolaMeeting)
ALTER TABLE "GranolaMeeting" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("summary", '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS "GranolaMeeting_search_vector_idx" ON "GranolaMeeting" USING GIN ("search_vector");

-- Scout findings: title, description
ALTER TABLE "ScoutFinding" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS "ScoutFinding_search_vector_idx" ON "ScoutFinding" USING GIN ("search_vector");
