import { TaskView } from "./task-view";

/**
 * Ordinary-user task surface. Reuse the complete local workflow and suppress
 * code-host record tabs; those live under External work.
 */
export function LocalTasksView() {
  return <TaskView localOnly />;
}
