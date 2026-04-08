import { createId } from "@paralleldrive/cuid2";

/** Generate a CUID2 — matches Prisma's @default(cuid()) format.
 *  Use this for client-generated IDs when creating records offline. */
export function generateCuid(): string {
  return createId();
}
