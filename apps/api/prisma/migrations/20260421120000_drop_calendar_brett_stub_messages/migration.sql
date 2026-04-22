-- Remove stub "coming soon" BrettMessage rows from the deprecated calendar
-- chat endpoint. The POST /calendar/events/:id/brett stub wrote permanent
-- junk rows that clients surfaced via GET. Both endpoints are now gone; these
-- rows serve no one.
--
-- Scope: only rows attached to calendar events (calendarEventId IS NOT NULL).
-- Item-attached BrettMessages (task chat) are live and untouched.
DELETE FROM "BrettMessage" WHERE "calendarEventId" IS NOT NULL;
