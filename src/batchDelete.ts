import type { Task } from './types.ts'

export function batchDeleteSummary(tasks: Task[], selected: ReadonlySet<string>) {
  const live = tasks.filter((task) => !task.deletedAt && selected.has(task.id))
  const plans = new Set(live.filter((task) => task.planDefinition).map((task) => task.id))
  return {
    count: live.length,
    plans: plans.size,
    schedules: live.length - plans.size,
    children: tasks.filter((task) => !task.deletedAt && task.planAllocation && plans.has(task.planAllocation.planId)).length,
  }
}

/** Remove selected plan containers atomically, detaching every child to keep backups and sync valid. */
export function deleteSelectedTasks(tasks: Task[], selected: ReadonlySet<string>, deletePlanChildren = false, deletedAt = new Date().toISOString()): Task[] {
  const live = tasks.filter((task) => !task.deletedAt && selected.has(task.id))
  if (!live.length) return tasks
  const plans = new Set(live.filter((task) => task.planDefinition).map((task) => task.id))
  return tasks.flatMap((task): Task[] => {
    if (plans.has(task.id)) return []
    if (task.planAllocation && plans.has(task.planAllocation.planId)) {
      const { planAllocation: _allocation, ...ordinary } = task
      return [{ ...ordinary, deletedAt: task.deletedAt ?? (deletePlanChildren || selected.has(task.id) ? deletedAt : null) }]
    }
    return [selected.has(task.id) && !task.deletedAt ? { ...task, deletedAt } : task]
  })
}
