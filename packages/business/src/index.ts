import type { Task } from "@brett/types";
import { generateId } from "@brett/utils";

export function createTask(
  title: string,
  userId: string,
  description?: string
): Task {
  const now = new Date();
  return {
    id: generateId(),
    title,
    description,
    completed: false,
    userId,
    createdAt: now,
    updatedAt: now,
  };
}

export function toggleTask(task: Task): Task {
  return {
    ...task,
    completed: !task.completed,
    updatedAt: new Date(),
  };
}
