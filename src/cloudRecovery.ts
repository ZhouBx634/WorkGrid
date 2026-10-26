import type { Task } from './types.ts'
import { taskFingerprint } from './cloudData.ts'
import { validateTaskList } from './backup.ts'

const RECOVERY_KEY = 'workgrid.cloud-recovery.v1'
const BASE_KEY_PREFIX = 'workgrid.cloud-base.v1:'
const MAX_RECOVERY_PER_USER = 5

export interface CloudRecoveryEntry {
  userId: string
  tasks: Task[]
  savedAt: string
  reason: string
}

export function loadCloudRecovery(userId: string): CloudRecoveryEntry[] {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY)
    const entries: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(entries)) return []
    return entries.filter((entry): entry is CloudRecoveryEntry =>
      typeof entry === 'object' && entry !== null &&
      (entry as CloudRecoveryEntry).userId === userId &&
      Array.isArray((entry as CloudRecoveryEntry).tasks) &&
      typeof (entry as CloudRecoveryEntry).savedAt === 'string' &&
      typeof (entry as CloudRecoveryEntry).reason === 'string',
    ).flatMap((entry) => {
      try { return [{ ...entry, tasks: validateTaskList(entry.tasks) }] } catch { return [] }
    }).reverse()
  } catch { return [] }
}

export function saveCloudRecovery(userId: string, tasks: Task[], reason: string): CloudRecoveryEntry[] | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY)
    const allEntries: unknown = raw ? JSON.parse(raw) : []
    const entries = Array.isArray(allEntries) ? allEntries.filter((entry) =>
      typeof entry === 'object' && entry !== null &&
      typeof (entry as CloudRecoveryEntry).userId === 'string' &&
      Array.isArray((entry as CloudRecoveryEntry).tasks) &&
      typeof (entry as CloudRecoveryEntry).savedAt === 'string' &&
      typeof (entry as CloudRecoveryEntry).reason === 'string',
    ) as CloudRecoveryEntry[] : []
    const fingerprint = taskFingerprint(tasks)
    const userEntries = entries.filter((entry) => {
      if (entry.userId !== userId) return false
      try { return taskFingerprint(entry.tasks) !== fingerprint } catch { return false }
    })
    userEntries.push({ userId, tasks: validateTaskList(tasks), savedAt: new Date().toISOString(), reason })
    const boundedEntries = userEntries.slice(-MAX_RECOVERY_PER_USER)
    const otherEntries = entries.filter((entry) => entry.userId !== userId)
    localStorage.setItem(RECOVERY_KEY, JSON.stringify([...otherEntries, ...boundedEntries]))
    return boundedEntries.reverse()
  } catch { return null }
}

export function loadCloudBase(userId: string): string | null {
  try { return localStorage.getItem(`${BASE_KEY_PREFIX}${userId}`) } catch { return null }
}

export function saveCloudBase(userId: string, fingerprint: string): boolean {
  try { localStorage.setItem(`${BASE_KEY_PREFIX}${userId}`, fingerprint); return true } catch { return false }
}
