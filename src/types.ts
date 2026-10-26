export type ViewMode = 'today' | 'month' | 'week' | 'day'

export type TaskStatus = 'todo' | 'in-progress' | 'completed'

export type TaskColor =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'indigo'
  | 'purple'

export type RecurrenceFrequency = 'daily' | 'weekdays' | 'weekly' | 'monthly'

export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  weekdays?: number[]
  until: string
}

export interface Task {
  id: string
  title: string
  color: TaskColor
  duration: number
  start: string | null
  createdAt: string
  status: TaskStatus
  completedAt: string | null
  reminderMinutes: number | null
  remindedAt: string | null
  endReminder: boolean
  endRemindedAt: string | null
  tags: string[]
  deletedAt: string | null
  seriesId?: string | null
  recurrence?: RecurrenceRule | null
  calendarImport?: CalendarImportSource
  // Plan records share the existing atomic storage/sync document, but never enter the calendar.
  planDefinition?: LongTermPlan
  planAllocation?: { planId: string; units: number[] }
}

export interface LongTermPlan {
  sortOrder?: number
  type: 'countable' | 'deadline'
  totalUnits: number
  unitLabel: string
  deadline: string | null
  notes: string
  reminderMinutes: number | null
}

export interface CalendarImportSource {
  calendarKey: string
  eventKey: string
  course: string
  location: string
  teacher: string
  teachingClass: string
  // Last imported values: local edits can be detected without using createdAt.
  originalTitle: string
  originalStart: string
  originalDuration: number
}

export interface TaskDraft {
  title: string
  color: TaskColor
  duration: number
  tags: string[]
}

export interface WorkGridBackup {
  format: 'workgrid-backup'
  schemaVersion: 8
  appVersion: string
  exportedAt: string
  taskCount: number
  tasks: Task[]
}
