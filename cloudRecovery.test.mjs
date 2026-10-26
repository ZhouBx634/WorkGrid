import assert from 'node:assert/strict'
import { loadCloudBase, loadCloudRecovery, saveCloudBase, saveCloudRecovery } from './src/cloudRecovery.ts'

const values = new Map()
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
}

const task = { id: 'recover-me', title: 'Recover', color: 'blue', duration: 30, start: null, createdAt: '2026-10-19T00:00:00.000Z', status: 'todo', completedAt: null, reminderMinutes: null, remindedAt: null, endReminder: false, endRemindedAt: null, tags: [], deletedAt: null }
assert.equal(saveCloudBase('user-a', '[{"id":"base"}]'), true)
assert.equal(loadCloudBase('user-a'), '[{"id":"base"}]')
assert.equal(loadCloudBase('user-b'), null)

const first = saveCloudRecovery('user-a', [task], '云端覆盖前')
assert.equal(first?.length, 1)
assert.equal(first?.[0].tasks[0].id, task.id)
assert.equal(saveCloudRecovery('user-a', [task], '重复快照')?.length, 1, 'duplicate snapshots should not fill recovery history')
assert.equal(saveCloudRecovery('user-b', [{ ...task, id: 'other-user' }], 'another account')?.length, 1)
assert.equal(loadCloudRecovery('user-a').length, 1, 'recovery snapshots are isolated per account')

for (let index = 0; index < 7; index++) saveCloudRecovery('user-a', [{ ...task, id: `task-${index}` }], 'test')
assert.equal(loadCloudRecovery('user-a').length, 5, 'recovery history stays bounded')
assert.equal(loadCloudRecovery('user-a')[0].tasks[0].id, 'task-6', 'newest recovery point is first after reload')
saveCloudRecovery('user-a', [{ ...task, id: 'task-2' }], 'recently reused')
assert.equal(loadCloudRecovery('user-a')[0].tasks[0].id, 'task-2', 'reused versions become the newest recovery point')
const previousSetItem = localStorage.setItem
localStorage.setItem = () => { throw new Error('quota exceeded') }
assert.equal(saveCloudRecovery('user-a', [task], 'blocked'), null, 'storage failures must block overwrite')
localStorage.setItem = previousSetItem

console.log('cloud recovery tests passed')
