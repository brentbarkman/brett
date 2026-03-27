import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { validateThings3Import } from "@brett/business";

const importRoutes = new Hono<AuthEnv>();

importRoutes.use("*", authMiddleware);

importRoutes.post("/things3", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const validation = validateThings3Import(body);

  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const { lists, tasks } = validation.data;

  const result = await prisma.$transaction(async (tx) => {
    // 1. Get existing list names for this user (for dedup)
    const existingLists = await tx.list.findMany({
      where: { userId: user.id },
      select: { name: true, sortOrder: true },
    });
    const existingNames = new Set(existingLists.map((l) => l.name));
    const maxSortOrder = existingLists.reduce((max, l) => Math.max(max, l.sortOrder), -1);

    // 2. Create lists, deduplicating names
    const uuidToListId = new Map<string, string>();
    let sortOrder = maxSortOrder + 1;

    for (const list of lists) {
      let name = list.name;
      if (existingNames.has(name)) {
        let counter = 2;
        while (existingNames.has(`${list.name} (${counter})`)) {
          counter++;
        }
        name = `${list.name} (${counter})`;
      }
      existingNames.add(name);

      const created = await tx.list.create({
        data: {
          name,
          colorClass: "bg-blue-400",
          sortOrder: sortOrder++,
          userId: user.id,
        },
      });
      uuidToListId.set(list.thingsUuid, created.id);
    }

    // 3. Create tasks in bulk
    const taskData = tasks.map((task) => {
      const listId = task.thingsProjectUuid
        ? uuidToListId.get(task.thingsProjectUuid) ?? null
        : null;

      return {
        type: "task" as const,
        title: task.title,
        notes: task.notes ?? null,
        source: "Things 3",
        status: task.status,
        dueDate: task.dueDate ? new Date(task.dueDate) : null,
        dueDatePrecision: task.dueDate ? "day" : null,
        completedAt: task.completedAt ? new Date(task.completedAt) : null,
        createdAt: task.createdAt ? new Date(task.createdAt) : undefined,
        listId,
        userId: user.id,
      };
    });

    if (taskData.length > 0) {
      await tx.item.createMany({ data: taskData });
    }

    return { lists: lists.length, tasks: taskData.length };
  });

  return c.json(result, 201);
});

export { importRoutes };
