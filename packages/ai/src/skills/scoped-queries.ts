import type { PrismaClient } from "@brett/api-core";

export function scopedItems(prisma: PrismaClient, userId: string) {
  return {
    findFirst: (where: Record<string, unknown>) =>
      prisma.item.findFirst({ where: { ...(where as object), userId } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany: (args: { where?: Record<string, unknown>; orderBy?: any; take?: number }) =>
      prisma.item.findMany({
        where: { ...args.where, userId },
        orderBy: args.orderBy,
        take: args.take,
      }),
    updateOwned: async (id: string, data: Record<string, unknown>) => {
      const item = await prisma.item.findFirst({ where: { id, userId } });
      if (!item) throw new Error("Not found");
      return prisma.item.update({ where: { id }, data });
    },
  };
}

export function scopedLists(prisma: PrismaClient, userId: string) {
  return {
    findFirst: (where: Record<string, unknown>) =>
      prisma.list.findFirst({ where: { ...(where as object), userId } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany: (args?: { where?: Record<string, unknown>; orderBy?: any }) =>
      prisma.list.findMany({
        where: { ...args?.where, userId },
        orderBy: args?.orderBy,
      }),
  };
}

export async function scopedEvents(prisma: PrismaClient, userId: string) {
  // Only include events from visible calendars — respects user's calendar visibility settings
  const visibleCalendars = await prisma.calendarList.findMany({
    where: { googleAccount: { userId }, isVisible: true },
    select: { id: true },
  });
  const calendarListIds = visibleCalendars.map((c) => c.id);

  // Exclude "observer" events (shared calendar, user not invited) and cancelled events
  const baseWhere = {
    userId,
    calendarListId: { in: calendarListIds },
    myResponseStatus: { not: "observer" },
    status: { not: "cancelled" },
  };
  return {
    findFirst: (where: Record<string, unknown>) =>
      prisma.calendarEvent.findFirst({ where: { ...(where as object), ...baseWhere } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany: (args: { where?: Record<string, unknown>; orderBy?: any; take?: number }) =>
      prisma.calendarEvent.findMany({
        where: { ...args.where, ...baseWhere },
        orderBy: args.orderBy,
        take: args.take,
      }),
  };
}
