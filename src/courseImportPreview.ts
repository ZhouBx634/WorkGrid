import type { CourseOccurrence } from './courseImport.ts'

export type CourseImportRange = 'future' | '4weeks' | '6weeks' | '14weeks' | 'all'

export function courseInRange(course: CourseOccurrence, range: CourseImportRange, now = new Date()) {
  if (range === 'all') return true
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const weeks = { '4weeks': 4, '6weeks': 6, '14weeks': 14 }
  const end = new Date(start)
  if (range !== 'future') end.setDate(end.getDate() + weeks[range] * 7)
  const timestamp = Date.parse(course.start)
  return timestamp >= start.getTime() && (range === 'future' || timestamp < end.getTime())
}

export function courseMatchesSearch(course: CourseOccurrence, query: string) {
  const keyword = query.trim().toLocaleLowerCase()
  return !keyword || [course.course, course.location, course.teacher, course.teachingClass].some((value) => value.toLocaleLowerCase().includes(keyword))
}

/** Synthetic, current-date sample; never use a student's timetable or subscription token. */
export function createSampleCourseCalendar(now = new Date()) {
  const monday = new Date(now)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7))
  const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const lessons = [
    { name: '示例 · 高等数学', day: 0, hour: 8, minute: 30, duration: 90, room: '示例教室 A101' },
    { name: '示例 · 程序设计', day: 2, hour: 14, minute: 0, duration: 120, room: '示例机房 B202' },
    { name: '示例 · 大学英语', day: 4, hour: 10, minute: 15, duration: 90, room: '示例教室 C303' },
  ].map((lesson, index) => {
    const start = new Date(monday)
    start.setDate(start.getDate() + lesson.day)
    start.setHours(lesson.hour, lesson.minute)
    const end = new Date(start.getTime() + lesson.duration * 60000)
    return ['BEGIN:VEVENT', `UID:workgrid-sample-${stamp(monday)}-${index}`, `SUMMARY:${lesson.name}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, 'RRULE:FREQ=WEEKLY;COUNT=4', `LOCATION:${lesson.room}`, 'DESCRIPTION:教师: 示例教师\\n教学班: 示例班级', 'END:VEVENT'].join('\r\n')
  })
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WorkGrid//Synthetic Timetable//CN', 'X-WR-CALNAME:WorkGrid 示例课表', ...lessons, 'END:VCALENDAR'].join('\r\n')
}
