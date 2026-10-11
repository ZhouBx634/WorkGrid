import assert from 'node:assert/strict'
import { dropDateFromPosition, parseDurationInput } from './src/scheduling.ts'
import { dueEndReminderTasks, dueReminderTasks } from './src/reminders.ts'
import { DEFAULT_SLOT_HEIGHT, fitSlotHeight, focusedTimeRange, parseCalendarZoom, stepCalendarZoom, timeRangeLabel } from './src/calendarZoom.ts'

for (const value of [null, '', '0', 'NaN', '10', '200', '37.5']) assert.equal(parseCalendarZoom(value), 100)
assert.equal(parseCalendarZoom('fit'), 'fit')
assert.equal(parseCalendarZoom('focus'), 'focus')
assert.equal(parseCalendarZoom('25'), 25)
assert.equal(parseCalendarZoom('150'), 150)
assert.equal(fitSlotHeight(648), 6)
assert.equal(fitSlotHeight(40), 1)
assert.equal(stepCalendarZoom(100, DEFAULT_SLOT_HEIGHT, -1), 75)
assert.equal(stepCalendarZoom(25, 5.5, -1), 25)
assert.equal(stepCalendarZoom(150, 33, 1), 150)
assert.equal(stepCalendarZoom('fit', 6, 1), 50)
assert.equal(stepCalendarZoom('fit', 6, -1), 25)
assert.equal(stepCalendarZoom('focus', 44, 1), 150)
assert.deepEqual(focusedTimeRange([]), { start: 0, end: 1440 })
const timed = (hour, minutes, duration, extra = {}) => ({ start: new Date(2026, 9, 9, hour, minutes).toISOString(), duration, ...extra })
assert.deepEqual(focusedTimeRange([timed(8, 30, 90), timed(19, 0, 140)]), { start: 480, end: 1320 })
assert.equal(timeRangeLabel({ start: 480, end: 1320 }), '08:00–22:00')
assert.deepEqual(focusedTimeRange([timed(0, 0, 1)]), { start: 0, end: 240 })
assert.deepEqual(focusedTimeRange([timed(23, 59, 120)]), { start: 1200, end: 1440 })
assert.deepEqual(focusedTimeRange([timed(10, 12, 56)]), { start: 480, end: 720 })
assert.deepEqual(focusedTimeRange([{ start: null, duration: 60 }, timed(3, 0, 60, { deletedAt: '2026-10-09' }), { start: 'invalid', duration: 60 }]), { start: 0, end: 1440 })

assert.equal(parseDurationInput(''), null)
assert.equal(parseDurationInput('0'), null)
assert.equal(parseDurationInput('056'), 56)
assert.equal(parseDurationInput('56'), 56)
assert.equal(parseDurationInput('720'), 720)
assert.equal(parseDurationInput('721'), null)
assert.equal(parseDurationInput('1.5'), null)

const day = new Date(2026, 9, 5)
const midnightDrop = dropDateFromPosition(day, 100, 100, 22)
const morningDrop = dropDateFromPosition(day, 100 + 30 * 22, 100, 22)
const lastSlotDrop = dropDateFromPosition(day, 100 + 96 * 22 + 50, 100, 22)
assert.deepEqual([midnightDrop.getHours(), midnightDrop.getMinutes()], [0, 0])
assert.deepEqual([morningDrop.getHours(), morningDrop.getMinutes()], [7, 30])
assert.deepEqual([lastSlotDrop.getHours(), lastSlotDrop.getMinutes()], [23, 45])
for (const height of [5.5, 11, 16.5, 22, 33, fitSlotHeight(648)]) {
  const scaledDrop = dropDateFromPosition(day, 100 + 41.5 * height, 100, height)
  assert.deepEqual([scaledDrop.getHours(), scaledDrop.getMinutes()], [10, 15])
  const focusedDrop = dropDateFromPosition(day, 100 + 9.5 * height, 100, height, 15, 480, 1320)
  assert.deepEqual([focusedDrop.getHours(), focusedDrop.getMinutes()], [10, 15])
  const focusedFirst = dropDateFromPosition(day, -999, 100, height, 15, 480, 1320)
  const focusedLast = dropDateFromPosition(day, 99999, 100, height, 15, 480, 1320)
  assert.deepEqual([focusedFirst.getHours(), focusedFirst.getMinutes()], [8, 0])
  assert.deepEqual([focusedLast.getHours(), focusedLast.getMinutes()], [21, 45])
}

// Real mobile focus geometry: grid layout yields 498.6875 rather than 498.695.
const roundedFocus = dropDateFromPosition(day, 498.6875, 460.625, 6.344999999999999, 15, 480, 1440)
assert.deepEqual([roundedFocus.getHours(), roundedFocus.getMinutes()], [9, 30])
const trulyBeforeBoundary = dropDateFromPosition(day, 498.595, 460.625, 6.344999999999999, 15, 480, 1440)
assert.deepEqual([trulyBeforeBoundary.getHours(), trulyBeforeBoundary.getMinutes()], [9, 15])
const roundedLast = dropDateFromPosition(day, 100 + 96 * 6.345, 100, 6.345)
assert.deepEqual([roundedLast.getHours(), roundedLast.getMinutes()], [23, 45])

const scheduledTask = {
  id: 'regression-task',
  title: '回归测试',
  color: 'blue',
  duration: 56,
  start: '2026-10-05T08:00:00.000Z',
  createdAt: '2026-10-05T07:00:00.000Z',
  status: 'todo',
  completedAt: null,
  reminderMinutes: 0,
  remindedAt: null,
  endReminder: true,
  endRemindedAt: null,
}

assert.equal(dueReminderTasks([scheduledTask], new Date('2026-10-05T08:00:00.000Z')).length, 1)
assert.equal(dueEndReminderTasks([scheduledTask], new Date('2026-10-05T08:55:59.000Z')).length, 0)
assert.equal(dueEndReminderTasks([scheduledTask], new Date('2026-10-05T08:56:00.000Z')).length, 1)
assert.equal(dueEndReminderTasks([{ ...scheduledTask, endRemindedAt: '2026-10-05T08:56:00.000Z' }], new Date('2026-10-05T08:57:00.000Z')).length, 0)

console.log('regression tests passed')
