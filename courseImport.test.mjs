import assert from 'node:assert/strict'
import { parseCourseCalendar, applyCourseImport, classifyCourse, undoCourseImport, courseOverlapCount } from './src/courseImport.ts'
import { createBackup, parseBackupText, validateTaskList, planImport } from './src/backup.ts'
import { parseCloudSnapshot } from './src/cloudData.ts'
import { saveCourseRecovery, loadCourseRecovery, clearCourseRecovery } from './src/courseRecovery.ts'
import { courseInRange, courseMatchesSearch, createSampleCourseCalendar } from './src/courseImportPreview.ts'

const now = new Date('2026-10-09T02:30:00Z')
function event({ uid = 'course-1', start = '20261012T083000', end = '20261012T100000', title = '数学', extra = '', tz = ';TZID=Asia/Shanghai' } = {}) {
  return `BEGIN:VEVENT\r\n${uid ? `UID:${uid}\r\n` : ''}DTSTAMP:20261009T021822Z\r\nSUMMARY:${title}\r\nDTSTART${tz}:${start}\r\nDTEND${tz}:${end}\r\nLOCATION:教室甲\r\nDESCRIPTION:教师: 教师甲\\,教师乙\\n教学班: 班级\r\n 甲\r\n${extra}END:VEVENT`
}
const calendar = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//School Fixture//CN\r\nX-WR-CALNAME:测试课表\r\n${events.join('\r\n')}\r\nEND:VCALENDAR`
const sample = calendar(event(), event({ uid: 'course-2', start: '20261013T140000', end: '20261013T162000' }))
const parsed = await parseCourseCalendar(sample, now)
assert.equal(parsed.events.length, 2)
assert.equal(parsed.events[0].start, '2026-10-12T00:30:00.000Z')
assert.equal(parsed.events[0].duration, 90)
assert.equal(parsed.events[1].duration, 140)
assert.equal(parsed.events[0].teacher, '教师甲,教师乙')
assert.equal(parsed.events[0].teachingClass, '班级甲')
assert.equal(parsed.events[0].color, parsed.events[1].color)

const original = { id: 'ordinary-1', title: '数学', color: 'red', duration: 45, start: '2026-10-12T00:30:00.000Z', createdAt: now.toISOString(), status: 'completed', completedAt: now.toISOString(), reminderMinutes: 5, remindedAt: now.toISOString(), endReminder: true, endRemindedAt: now.toISOString(), tags: ['原日程'], deletedAt: null }
const before = JSON.stringify(original)
const first = applyCourseImport([original], parsed.events)
assert.equal(first.added, 2)
assert.equal(JSON.stringify(first.tasks[0]), before, 'ordinary schedule must remain byte-for-byte identical')
assert.equal(courseOverlapCount([original], parsed.events[0]), 1)
assert.equal(first.tasks.length, 3)
assert.equal(new Set(first.tasks.map(task => task.id)).size, 3)
const secondParsed = await parseCourseCalendar(sample.replaceAll('20261009T021822Z', '20261010T021822Z'), now)
const repeated = applyCourseImport(first.tasks, secondParsed.events)
assert.equal(repeated.added, 0)
assert.equal(repeated.updated, 0)
assert.deepEqual(repeated.tasks, first.tasks)

const changed = (await parseCourseCalendar(calendar(event({ start: '20261012T103000', end: '20261012T120000' })), now)).events[0]
assert.equal(classifyCourse(first.tasks, changed), 'update')
assert.equal(applyCourseImport(first.tasks, [changed]).updated, 0, 'updates require explicit approval')
const updated = applyCourseImport(first.tasks, [changed], new Set([changed.key]))
assert.equal(updated.updated, 1)
assert.deepEqual(updated.tasks[0], original)
assert.deepEqual(undoCourseImport(updated.tasks, updated.changes).tasks, first.tasks)
const localEdit = first.tasks.map(task => task.calendarImport?.eventKey === changed.key ? { ...task, title: '自己调整', color: 'purple', status: 'completed', tags: ['保留'], reminderMinutes: 10, start: '2026-10-12T03:00:00.000Z' } : task)
assert.equal(classifyCourse(localEdit, changed), 'local-edit')
assert.deepEqual(applyCourseImport(localEdit, [changed]).tasks, localEdit)
const override = applyCourseImport(localEdit, [changed], new Set([changed.key])).tasks[1]
assert.equal(override.title, changed.course)
assert.equal(override.color, 'purple')
assert.deepEqual(override.tags, ['保留'])
assert.equal(override.status, 'completed')
assert.equal(override.reminderMinutes, 10)
const deleted = first.tasks.map(task => task.calendarImport ? { ...task, deletedAt: now.toISOString() } : task)
assert.equal(applyCourseImport(deleted, parsed.events, new Set(parsed.events.map(e => e.key))).changes.length, 0)

const laterOrdinary = { ...original, id: 'ordinary-later', title: '导入后新增的日程' }
const laterChanges = first.tasks.map(task => task.id === original.id ? { ...task, title: '原日程后来修改' } : task)
const undo = undoCourseImport([...laterChanges, laterOrdinary], first.changes)
assert.deepEqual(undo.tasks, [laterChanges[0], laterOrdinary])
const editedImported = first.tasks.map(task => task.calendarImport?.eventKey === parsed.events[0].key ? { ...task, title: '导入后修改的课程' } : task)
const safeUndo = undoCourseImport(editedImported, first.changes)
assert.equal(safeUndo.skipped, 1)
assert.equal(safeUndo.tasks.length, 2)
assert.equal(safeUndo.tasks[1].title, '导入后修改的课程')

const roundTrip = parseBackupText(JSON.stringify(createBackup(first.tasks)))
assert.deepEqual(roundTrip.tasks[1].calendarImport, first.tasks[1].calendarImport)
assert.equal(planImport(roundTrip.tasks, createBackup(first.tasks)).added, 0)
assert.deepEqual(parseCloudSnapshot({ tasks: first.tasks, revision: 1, updated_at: now.toISOString() }).tasks[1].calendarImport, first.tasks[1].calendarImport)
assert.equal(applyCourseImport(roundTrip.tasks, parsed.events).added, 0)
assert.throws(() => validateTaskList([{ ...first.tasks[1], calendarImport: { ...first.tasks[1].calendarImport, originalDuration: -1 } }]))
const memory = new Map()
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) }
saveCourseRecovery(first.changes)
assert.deepEqual(undoCourseImport(first.tasks, loadCourseRecovery()).tasks, [original])
clearCourseRecovery()
assert.equal(loadCourseRecovery(), null)

const weekly = await parseCourseCalendar(calendar(event({ extra: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=2\r\n' })), now)
assert.deepEqual(weekly.events.map(e => e.start), ['2026-10-12T00:30:00.000Z', '2026-10-14T00:30:00.000Z'])
const fortnightly = await parseCourseCalendar(calendar(event({ extra: 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=3\r\n' })), now)
assert.deepEqual(fortnightly.events.map(e => e.start.slice(0, 10)), ['2026-10-12', '2026-10-26', '2026-11-09'])
const exclusions = await parseCourseCalendar(calendar(event({ extra: 'RRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE;TZID=Asia/Shanghai:20261019T083000,20261026T083000\r\n' })), now)
assert.deepEqual(exclusions.events.map(e => e.start.slice(0, 10)), ['2026-10-12', '2026-11-02'])
const overrideICS = calendar(event({ extra: 'RRULE:FREQ=WEEKLY;COUNT=2\r\n' }), event({ start: '20261019T103000', end: '20261019T120000', extra: 'RECURRENCE-ID;TZID=Asia/Shanghai:20261019T083000\r\n' }))
const overrideEvents = await parseCourseCalendar(overrideICS, now)
assert.equal(overrideEvents.events.length, 2)
assert.equal(overrideEvents.events[1].start, '2026-10-19T02:30:00.000Z')
assert.equal(new Set(overrideEvents.events.map(e => e.key)).size, 2)
const missingUID = await parseCourseCalendar(calendar(event({ uid: '' }), event({ uid: '', start: '20261013T083000', end: '20261013T100000' })), now)
assert.equal(new Set(missingUID.events.map(e => e.key)).size, 2)
assert.equal(applyCourseImport(applyCourseImport([], missingUID.events).tasks, missingUID.events).added, 0)
const utc = await parseCourseCalendar(calendar(event({ tz: '', start: '20261012T003000Z', end: '20261012T020000Z' })), now)
assert.equal(utc.events[0].start, parsed.events[0].start)
const midnight = await parseCourseCalendar(calendar(event({ start: '20261012T233000', end: '20261013T003000' })), now)
assert.equal(midnight.events[0].duration, 60)
const allDay = await parseCourseCalendar(calendar(event({ tz: ';VALUE=DATE', start: '20261012', end: '20261013' })), now)
assert.equal(allDay.events.length, 0)
assert.equal(allDay.warnings.length, 1)
const malicious = await parseCourseCalendar(calendar(event({ title: '<img src=x onerror=alert(1)>' })), now)
assert.equal(malicious.events[0].course, '<img src=x onerror=alert(1)>')
await assert.rejects(parseCourseCalendar(calendar(event(), event()), now), /重复/)
await assert.rejects(parseCourseCalendar(calendar(event({ end: '20261012T080000' })), now), /时长/)
await assert.rejects(parseCourseCalendar(calendar(event({ tz: ';TZID=Unknown/Zone' })), now), /时区/)
await assert.rejects(parseCourseCalendar(sample.slice(0, -15), now), /完整/)
await assert.rejects(parseCourseCalendar(calendar(event({ start: '20260230T083000', end: '20260230T100000' })), now), /不存在/)
const until = await parseCourseCalendar(calendar(event({ extra: 'RRULE:FREQ=WEEKLY;UNTIL=20261026T003000Z\r\n' })), now)
assert.equal(until.events.length, 3)
const rdate = await parseCourseCalendar(calendar(event({ extra: 'RDATE;TZID=Asia/Shanghai:20261019T083000,20261026T083000\r\n' })), now)
assert.equal(rdate.events.length, 3)
const rdateWithExclusion = await parseCourseCalendar(calendar(event({ extra: 'RDATE;TZID=Asia/Shanghai:20261019T083000\r\nEXDATE;TZID=Asia/Shanghai:20261012T083000\r\n' })), now)
assert.deepEqual(rdateWithExclusion.events.map(e => e.start), ['2026-10-19T00:30:00.000Z'])
const cancellation = await parseCourseCalendar(calendar(event({ extra: 'STATUS:CANCELLED\r\n' })), now)
assert.equal(cancellation.events.length, 0)
const timezone = 'BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700308T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nEND:DAYLIGHT\r\nBEGIN:STANDARD\r\nDTSTART:19701101T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n'
const dst = await parseCourseCalendar(calendar(event({ tz: ';TZID=America/New_York', start: '20261026T083000', end: '20261026T100000', extra: 'RRULE:FREQ=WEEKLY;COUNT=2\r\n' })).replace('BEGIN:VEVENT', timezone + 'BEGIN:VEVENT'), now)
assert.deepEqual(dst.events.map(e => e.start), ['2026-10-26T12:30:00.000Z', '2026-11-02T13:30:00.000Z'])
await assert.rejects(parseCourseCalendar(calendar(event({ extra: 'RRULE:FREQ=SECONDLY;COUNT=999999999\r\n' })), now), /暂不支持/)
await assert.rejects(parseCourseCalendar(' '.repeat(2 * 1024 * 1024 + 1)), /2MB/)

// Preview range uses whole local calendar days and an exclusive end, not elapsed UTC hours.
const originalTimezone = process.env.TZ
process.env.TZ = 'Asia/Shanghai'
const rangeNow = new Date('2026-10-09T10:30:00Z')
const occurrence = (start) => ({ ...parsed.events[0], start })
assert.equal(courseInRange(occurrence('2026-10-08T15:59:00Z'), 'future', rangeNow), false)
assert.equal(courseInRange(occurrence('2026-10-08T16:00:00Z'), 'future', rangeNow), true)
assert.equal(courseInRange(occurrence('2026-11-05T15:59:00Z'), '4weeks', rangeNow), true)
assert.equal(courseInRange(occurrence('2026-11-05T16:00:00Z'), '4weeks', rangeNow), false)
assert.equal(courseInRange(occurrence('2026-11-19T15:59:00Z'), '6weeks', rangeNow), true)
assert.equal(courseInRange(occurrence('2026-11-19T16:00:00Z'), '6weeks', rangeNow), false)
assert.equal(courseInRange(occurrence('2027-01-14T15:59:00Z'), '14weeks', rangeNow), true)
assert.equal(courseInRange(occurrence('2027-01-14T16:00:00Z'), '14weeks', rangeNow), false)
assert.equal(courseInRange(occurrence('2020-01-01T00:00:00Z'), 'all', rangeNow), true)
process.env.TZ = 'America/New_York'
assert.equal(courseInRange(occurrence('2026-11-06T04:59:00Z'), '4weeks', new Date('2026-10-09T12:00:00Z')), true)
assert.equal(courseInRange(occurrence('2026-11-06T05:00:00Z'), '4weeks', new Date('2026-10-09T12:00:00Z')), false)
if (originalTimezone === undefined) delete process.env.TZ
else process.env.TZ = originalTimezone

assert.equal(courseMatchesSearch(parsed.events[0], ' 数学 '), true)
assert.equal(courseMatchesSearch(parsed.events[0], '教室甲'), true)
assert.equal(courseMatchesSearch(parsed.events[0], '教师乙'), true)
assert.equal(courseMatchesSearch(parsed.events[0], '班级甲'), true)
assert.equal(courseMatchesSearch({ ...parsed.events[0], course: 'Python Programming' }, 'PYTHON'), true)
assert.equal(courseMatchesSearch(parsed.events[0], ''), true)
assert.equal(courseMatchesSearch(parsed.events[0], 'not-found'), false)
for (const date of ['2026-10-10T02:30:00Z', '2026-12-31T02:30:00Z', '2027-04-01T02:30:00Z']) {
  const sampleNow = new Date(date)
  const demo = await parseCourseCalendar(createSampleCourseCalendar(sampleNow), sampleNow)
  assert.equal(demo.name, 'WorkGrid 示例课表')
  assert.equal(demo.events.length, 12)
  assert.equal(new Set(demo.events.map(item => item.course)).size, 3)
  assert.equal(new Set(demo.events.map(item => item.key)).size, 12)
  assert.ok(demo.events.every(item => Date.parse(item.start) > sampleNow.getTime() && item.course.startsWith('示例 · ')))
  const sampleImport = applyCourseImport([original], demo.events)
  assert.deepEqual(undoCourseImport(sampleImport.tasks, sampleImport.changes).tasks, [original])
  assert.equal(applyCourseImport(sampleImport.tasks, demo.events).added, 0)
}
console.log('course import tests passed: isolation, duplicates, updates, safe undo, backup/cloud, ICS recurrence and security')
