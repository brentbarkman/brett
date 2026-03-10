import { Button } from "@brett/ui";
import { createTask } from "@brett/business";
import { formatDate } from "@brett/utils";
import type { Task } from "@brett/types";

export function App() {
  const task: Task = createTask("Hello from Desktop", "user-1");

  return (
    <div>
      <h1>Brett Productivity - Desktop</h1>
      <p>Task: {task.title}</p>
      <p>Created: {formatDate(task.createdAt)}</p>
      <Button variant="primary">Get Started</Button>
    </div>
  );
}
