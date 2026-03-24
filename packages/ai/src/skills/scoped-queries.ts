import type { PrismaClient } from "@prisma/client";

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

export function scopedEvents(prisma: PrismaClient, userId: string) {
  return {
    findFirst: (where: Record<string, unknown>) =>
      prisma.calendarEvent.findFirst({ where: { ...(where as object), userId } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany: (args: { where?: Record<string, unknown>; orderBy?: any; take?: number }) =>
      prisma.calendarEvent.findMany({
        where: { ...args.where, userId },
        orderBy: args.orderBy,
        take: args.take,
      }),
  };
}
