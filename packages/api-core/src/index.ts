export { prisma } from "./prisma.js";
export { createAuth, type Auth, type AuthOptions } from "./auth.js";
export { createAuthMiddleware, type AuthEnv } from "./middleware/auth.js";
export { requireAdmin } from "./middleware/require-admin.js";
export { errorHandler } from "./middleware/error-handler.js";
export { createBaseApp, type BaseAppOptions } from "./app.js";
// Re-export generated Prisma client types for all workspace consumers
export { PrismaClient, Prisma } from "./generated/client/client.js";
export type {
  // Model types
  User, Session, Account, Verification, Passkey,
  List, Item, Attachment, ItemLink, BrettMessage,
  GoogleAccount, CalendarList, CalendarEvent, CalendarEventNote,
  GranolaAccount, MeetingNote, MeetingNoteSource,
  UserAIConfig, ConversationSession, ConversationMessage,
  UserFact, Embedding, AIUsageLog, WeatherCache,
  Scout, ScoutRun, ScoutFinding, ScoutActivity, ScoutMemory, ScoutConsolidation,
} from "./generated/client/client.js";
// Re-export enums
export {
  UserRole, ScoutStatus, ScoutSensitivity, ScoutRunStatus,
  FindingType, ScoutActivityType, ScoutMemoryType, ScoutMemoryStatus,
  ScoutConsolidationStatus,
} from "./generated/client/client.js";
