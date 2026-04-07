import { PrismaClient } from "@brett/api-core";

const prisma = new PrismaClient();

async function main() {
  const messages = await prisma.brettMessage.findMany({
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${messages.length} BrettMessages to migrate`);

  // Group by itemId or calendarEventId
  const groups = new Map<string, typeof messages>();
  for (const msg of messages) {
    const key = msg.itemId
      ? `item:${msg.itemId}`
      : msg.calendarEventId
        ? `event:${msg.calendarEventId}`
        : `user:${msg.userId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(msg);
  }

  console.log(`Grouped into ${groups.size} sessions`);

  let sessionsCreated = 0;
  let messagesCreated = 0;

  for (const [key, msgs] of groups) {
    const first = msgs[0];
    const session = await prisma.conversationSession.create({
      data: {
        userId: first.userId,
        source: "brett_thread",
        itemId: first.itemId,
        calendarEventId: first.calendarEventId,
        modelTier: "none",
        modelUsed: "stub",
      },
    });
    sessionsCreated++;

    for (const msg of msgs) {
      await prisma.conversationMessage.create({
        data: {
          sessionId: session.id,
          role: msg.role === "brett" ? "assistant" : "user",
          content: msg.content,
        },
      });
      messagesCreated++;
    }
  }

  console.log(
    `Migration complete: ${sessionsCreated} sessions, ${messagesCreated} messages created`,
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
