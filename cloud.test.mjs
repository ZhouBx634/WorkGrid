import assert from 'node:assert/strict'
import { classifyIncomingCloudSnapshot, classifyInitialSync, cloudDataMatches, cloudSyncErrorMessage, compactTaskFingerprint, loginErrorMessage, otpVerificationErrorMessage, parseCloudSnapshot, shouldApplyCloudSnapshot, taskFingerprint } from './src/cloudData.ts'

const task = {
  id: 'cloud-task',
  title: '云同步测试',
  color: 'green',
  duration: 45,
  start: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  status: 'todo',
  completedAt: null,
  reminderMinutes: null,
  remindedAt: null,
  endReminder: false,
  endRemindedAt: null,
  tags: [],
  deletedAt: null,
}

const snapshot = parseCloudSnapshot({ tasks: [task], revision: 3, updated_at: '2026-10-05T01:00:00.000Z' })
assert.equal(snapshot.tasks.length, 1)
assert.equal(snapshot.revision, 3)
assert.equal(taskFingerprint(snapshot.tasks), taskFingerprint([task]))
const reorderedTask = Object.fromEntries(Object.entries(task).reverse())
assert.equal(cloudDataMatches([task], [reorderedTask]), true, 'JSONB key ordering is not a user edit')
assert.equal(cloudDataMatches([task], [{ ...task, seriesId: null, recurrence: null }]), true, 'legacy nullable fields match the cloud representation')
assert.equal(cloudDataMatches([task, { ...task, id: 'second' }], [{ ...task, id: 'second' }, task]), true, 'array ordering is not a data conflict')
assert.equal(cloudDataMatches(snapshot.tasks, [{ ...task }]), true)
assert.equal(cloudDataMatches(snapshot.tasks, [{ ...task, duration: 60 }]), false)
const previousCloudFingerprint = taskFingerprint(snapshot.tasks)
const localEdit = [{ ...task, duration: 60 }]
const incomingEdit = [{ ...task, duration: 90 }]
assert.equal(shouldApplyCloudSnapshot(snapshot.tasks, previousCloudFingerprint, incomingEdit), true)
assert.equal(shouldApplyCloudSnapshot(localEdit, previousCloudFingerprint, incomingEdit), false)
assert.equal(shouldApplyCloudSnapshot(localEdit, previousCloudFingerprint, localEdit), true)
assert.equal(classifyIncomingCloudSnapshot(snapshot.tasks, previousCloudFingerprint, incomingEdit), 'apply-cloud')
assert.equal(classifyIncomingCloudSnapshot(localEdit, previousCloudFingerprint, incomingEdit), 'conflict')
assert.equal(classifyIncomingCloudSnapshot(localEdit, previousCloudFingerprint, localEdit), 'unchanged')
assert.equal(classifyIncomingCloudSnapshot(localEdit, previousCloudFingerprint, [task]), 'upload-local', 'a revision-only notification must not conflict with local-only edits')
assert.equal(shouldApplyCloudSnapshot(localEdit, previousCloudFingerprint, [task]), false, 'do not replace newer local content with the unchanged baseline')
assert.equal(classifyInitialSync(localEdit, [task], previousCloudFingerprint), 'upload-local', 'reload with only local edits resumes uploading')
assert.equal(classifyInitialSync([], [task], null), 'apply-cloud', 'a blank browser must not replace a populated cloud copy')
assert.equal(classifyInitialSync([task], [], null), 'upload-local', 'an empty cloud can be initialized from existing local data')
assert.equal(classifyInitialSync([], [], null), 'synced')
assert.equal(classifyInitialSync([task], [], compactTaskFingerprint([task])), 'choose', 'a cloud-side deletion must not silently erase unchanged local data')
assert.equal(classifyInitialSync([], [task], compactTaskFingerprint([task])), 'choose', 'a local deletion must not silently erase unchanged cloud data')
assert.equal(classifyInitialSync([task], [ { ...task, duration: 90 } ], compactTaskFingerprint([task])), 'apply-cloud', 'remote-only changes can flow automatically after a prior sync')
assert.equal(classifyInitialSync([{ ...task, duration: 30 }], [ { ...task, duration: 90 } ], compactTaskFingerprint([task])), 'choose', 'concurrent edits still require a real conflict decision')
assert.equal(cloudSyncErrorMessage({ message: 'Failed to fetch' }), '网络连接异常')
assert.equal(cloudSyncErrorMessage({ message: 'database unavailable' }), '服务返回：database unavailable')
assert.equal(loginErrorMessage({ status: 429, message: 'email rate limit exceeded' }), '发送请求过于频繁，请等待几分钟后再试。')
assert.equal(loginErrorMessage(new TypeError('Failed to fetch')), '无法连接登录服务，请检查网络后重试。')
assert.equal(loginErrorMessage({ message: 'unexpected auth error' }), '登录链接发送失败，请稍后重试。')
assert.equal(otpVerificationErrorMessage({ code: 'otp_expired', message: 'token has expired' }), '验证码无效或已过期，请重新发送。')
assert.equal(otpVerificationErrorMessage({ status: 429 }), '验证请求过于频繁，请稍后再试。')
assert.throws(() => parseCloudSnapshot({ tasks: [{ ...task, duration: 0 }], revision: 1, updated_at: '2026-10-05T01:00:00.000Z' }))
assert.throws(() => parseCloudSnapshot({ tasks: [task, task], revision: 1, updated_at: '2026-10-05T01:00:00.000Z' }))
assert.throws(() => parseCloudSnapshot({ tasks: [], revision: 0, updated_at: '2026-10-05T01:00:00.000Z' }))

console.log('cloud sync tests passed')
