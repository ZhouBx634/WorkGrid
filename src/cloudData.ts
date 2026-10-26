import { validateTaskList } from './backup.ts'
import type { Task } from './types.ts'

export interface CloudSnapshot {
  tasks: Task[]
  revision: number
  updatedAt: string
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalValue(item)]))
}

export function taskFingerprint(tasks: Task[]) {
  // JSONB can reorder keys. Legacy local data also explicitly stores null optional
  // fields that the cloud parser omits. Compare normalized content, never wire JSON.
  const normalized = validateTaskList(tasks).sort((left, right) => left.id.localeCompare(right.id))
  return JSON.stringify(canonicalValue(normalized))
}

export const compactTaskFingerprint = taskFingerprint

export function parseCloudSnapshot(value: unknown): CloudSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('云端数据格式不正确')
  }
  const row = value as Record<string, unknown>
  if (typeof row.revision !== 'number' || !Number.isInteger(row.revision) || row.revision < 1) {
    throw new Error('云端数据版本无效')
  }
  if (typeof row.updated_at !== 'string' || Number.isNaN(Date.parse(row.updated_at))) {
    throw new Error('云端更新时间无效')
  }
  return {
    tasks: validateTaskList(row.tasks),
    revision: row.revision,
    updatedAt: row.updated_at,
  }
}

export function cloudDataMatches(left: Task[], right: Task[]) {
  return taskFingerprint(left) === taskFingerprint(right)
}

export type IncomingCloudAction = 'unchanged' | 'apply-cloud' | 'upload-local' | 'conflict'

export type InitialSyncAction = 'synced' | 'apply-cloud' | 'upload-local' | 'choose'

export function classifyInitialSync(localTasks: Task[], cloudTasks: Task[], previousFingerprint: string | null): InitialSyncAction {
  const localFingerprint = compactTaskFingerprint(localTasks)
  const cloudFingerprint = compactTaskFingerprint(cloudTasks)
  if (localFingerprint === cloudFingerprint) return 'synced'

  if (previousFingerprint) {
    const localUnchanged = localFingerprint === previousFingerprint
    const cloudUnchanged = cloudFingerprint === previousFingerprint
    if (localUnchanged && !cloudUnchanged && cloudTasks.length > 0) return 'apply-cloud'
    if (cloudUnchanged && !localUnchanged && localTasks.length > 0) return 'upload-local'
    return 'choose'
  }

  // On a new device, a blank local store should never silently erase a populated cloud copy.
  if (localTasks.length === 0 && cloudTasks.length > 0) return 'apply-cloud'
  if (cloudTasks.length === 0 && localTasks.length > 0) return 'upload-local'
  if (localTasks.length === 0 && cloudTasks.length === 0) return 'synced'
  return 'choose'
}

export function classifyIncomingCloudSnapshot(localTasks: Task[], baseFingerprint: string | null, incomingTasks: Task[]): IncomingCloudAction {
  const localFingerprint = taskFingerprint(localTasks)
  const incomingFingerprint = taskFingerprint(incomingTasks)
  if (localFingerprint === incomingFingerprint) return 'unchanged'
  if (localFingerprint === baseFingerprint) return 'apply-cloud'
  if (incomingFingerprint === baseFingerprint) return 'upload-local'
  return 'conflict'
}

export function shouldApplyCloudSnapshot(localTasks: Task[], lastCloudFingerprint: string | null, incomingTasks: Task[]) {
  const action = classifyIncomingCloudSnapshot(localTasks, lastCloudFingerprint, incomingTasks)
  return action === 'unchanged' || action === 'apply-cloud'
}

export function cloudSyncErrorMessage(error: unknown) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return '当前设备处于离线状态'
  if (typeof error !== 'object' || error === null) return '云端服务暂时不可用'
  const message = typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message.trim()
    : ''
  if (/fetch|network|timeout/i.test(message)) return '网络连接异常'
  return message ? `服务返回：${message}` : '云端服务暂时不可用'
}

export function loginErrorMessage(error: unknown) {
  if (typeof error !== 'object' || error === null) return '登录链接发送失败，请稍后重试。'
  const details = error as { code?: unknown; message?: unknown; status?: unknown }
  const code = typeof details.code === 'string' ? details.code.toLowerCase() : ''
  const message = typeof details.message === 'string' ? details.message.toLowerCase() : ''
  if (details.status === 429 || code.includes('rate_limit') || message.includes('rate limit')) return '发送请求过于频繁，请等待几分钟后再试。'
  if (code.includes('invalid') || message.includes('invalid email')) return '邮箱地址无效，请检查后重试。'
  if (message.includes('fetch') || message.includes('network')) return '无法连接登录服务，请检查网络后重试。'
  return '登录链接发送失败，请稍后重试。'
}

export function otpVerificationErrorMessage(error: unknown) {
  if (typeof error !== 'object' || error === null) return '验证码验证失败，请稍后重试。'
  const details = error as { code?: unknown; message?: unknown; status?: unknown }
  const code = typeof details.code === 'string' ? details.code.toLowerCase() : ''
  const message = typeof details.message === 'string' ? details.message.toLowerCase() : ''
  if (details.status === 429 || code.includes('rate_limit') || message.includes('rate limit')) return '验证请求过于频繁，请稍后再试。'
  if (code.includes('expired') || code.includes('invalid') || message.includes('expired') || message.includes('invalid')) return '验证码无效或已过期，请重新发送。'
  if (message.includes('fetch') || message.includes('network')) return '无法连接登录服务，请检查网络后重试。'
  return '验证码验证失败，请稍后重试。'
}
