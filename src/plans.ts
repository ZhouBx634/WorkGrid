import type { LongTermPlan, Task, TaskColor } from './types.ts'

function id() { return globalThis.crypto.randomUUID() }

export function createPlan(title: string, color: TaskColor, duration: number, definition: LongTermPlan): Task {
  return { id: id(), title: title.trim(), color, duration, start: null, createdAt: new Date().toISOString(), status: 'todo', completedAt: null, reminderMinutes: null, remindedAt: null, endReminder: false, endRemindedAt: null, tags: [], deletedAt: null, planDefinition: definition }
}

export function planChildren(tasks: Task[], planId: string) { return tasks.filter((task) => task.planAllocation?.planId === planId) }

export function planStats(tasks: Task[], plan: Task) {
  const children = planChildren(tasks, plan.id)
  const count = (items: Task[]) => items.reduce((sum, task) => sum + task.planAllocation!.units.length, 0)
  const completed = count(children.filter((task) => !task.deletedAt && task.status === 'completed'))
  const scheduled = count(children.filter((task) => !task.deletedAt && task.start))
  const total = plan.planDefinition!.totalUnits
  return { total, scheduled, completed, waiting: count(children.filter((task) => !task.deletedAt && !task.start && task.status !== 'completed')), ungenerated: total - count(children) }
}

export function unitTitle(plan: Task, units: number[]) {
  const sorted = [...units].sort((a, b) => a - b)
  const consecutive = sorted.every((unit, index) => index === 0 || unit === sorted[index - 1] + 1)
  const label = consecutive && sorted.length > 1 ? `${sorted[0]}-${sorted.at(-1)}` : sorted.join('、')
  return `${plan.title.slice(0, 30)} · 第 ${label} ${plan.planDefinition!.unitLabel}`.slice(0, 60)
}

/** Generate only unallocated units. Repeating this action cannot duplicate a lesson. */
export function splitPlan(tasks: Task[], planId: string, groupSize: number): Task[] {
  const plan = tasks.find((task) => task.id === planId && task.planDefinition?.type === 'countable')
  if (!plan || !Number.isInteger(groupSize) || groupSize < 1 || groupSize > plan.planDefinition!.totalUnits) throw new Error('拆分数量无效')
  const used = new Set(planChildren(tasks, planId).flatMap((task) => task.planAllocation!.units))
  const available = Array.from({ length: plan.planDefinition!.totalUnits }, (_, i) => i + 1).filter((unit) => !used.has(unit))
  const generated: Task[] = []
  for (let offset = 0; offset < available.length; offset += groupSize) {
    const units = available.slice(offset, offset + groupSize)
    const duration = plan.duration * units.length
    if (duration > 720) throw new Error('每个日程最多 720 分钟，请减少每组数量或每单位时长')
    generated.push({ ...createPlan(unitTitle(plan, units), plan.color, duration, plan.planDefinition!), planDefinition: undefined, planAllocation: { planId, units } })
  }
  return generated.length ? [...tasks, ...generated] : tasks
}

export function mergePlanParts(tasks: Task[], planId: string, selected: Set<string>): Task[] {
  const parts = planChildren(tasks, planId).filter((task) => selected.has(task.id))
  const plan = tasks.find((task) => task.id === planId && task.planDefinition)
  if (!plan || parts.length < 2 || parts.some((task) => task.start || task.deletedAt || task.status !== 'todo')) throw new Error('只能合并至少两个未开始的待安排日程')
  const duration = parts.reduce((sum, task) => sum + task.duration, 0)
  if (duration > 720) throw new Error('合并后的日程超过 720 分钟，请减少选择数量')
  const first = parts[0]
  if (parts.some((task) => task.color !== first.color || JSON.stringify(task.tags) !== JSON.stringify(first.tags) || task.reminderMinutes !== first.reminderMinutes || task.endReminder !== first.endReminder)) throw new Error('所选日程的颜色、标签或提醒不同，请先统一设置再合并')
  const units = parts.flatMap((task) => task.planAllocation!.units).sort((a, b) => a - b)
  const merged = { ...first, id: id(), title: unitTitle(plan, units), duration, planAllocation: { planId, units } }
  return [...tasks.filter((task) => !parts.some((part) => part.id === task.id)), merged]
}

export function removePlan(tasks: Task[], planId: string) {
  return tasks.filter((task) => task.id !== planId).map((task) => {
    if (task.planAllocation?.planId !== planId) return task
    const { planAllocation: _allocation, ...ordinary } = task
    return ordinary
  })
}

export function deadlineLabel(deadline: string, now = new Date()) {
  const remaining = Date.parse(deadline) - now.getTime()
  if (remaining < 0) return '已逾期'
  if (new Date(deadline).toDateString() === now.toDateString()) return '今天截止'
  if (remaining < 86400000) return '不足 1 天'
  return `还剩 ${Math.ceil(remaining / 86400000)} 天`
}

export function duePlanReminders(tasks: Task[], now = new Date()) {
  return tasks.filter((task) => {
    const plan = task.planDefinition
    if (!plan?.deadline || plan.reminderMinutes === null || task.status === 'completed' || task.deletedAt || task.remindedAt || (plan.type === 'countable' && planStats(tasks, task).completed === plan.totalUnits)) return false
    const deadline = Date.parse(plan.deadline)
    return now.getTime() >= deadline - plan.reminderMinutes * 60000 && now.getTime() <= deadline
  })
}
