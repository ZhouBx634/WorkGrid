export function parseDurationInput(value: string) {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null
  const duration = Number(normalized)
  return Number.isInteger(duration) && duration >= 1 && duration <= 720 ? duration : null
}

export function durationFromTimes(start: string, end: string) {
  if (!start || !end) return null
  const minutes = (Date.parse(end) - Date.parse(start)) / 60000
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 720 ? minutes : null
}

export function endFromDuration(start: string, duration: string) {
  const minutes = parseDurationInput(duration)
  if (!start || !Number.isFinite(Date.parse(start)) || minutes === null) return ''
  const end = new Date(Date.parse(start) + minutes * 60000)
  return new Date(end.getTime() - end.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function dropDateFromPosition(day: Date, pointerY: number, trackTop: number, slotHeight: number, slotMinutes = 15, startMinutes = 0, endMinutes = 1440) {
  const slotCount = (endMinutes - startMinutes) / slotMinutes
  const relativeY = Math.max(0, Math.min(slotCount * slotHeight - 0.000001, pointerY - trackTop))
  const slotIndex = Math.floor(relativeY / slotHeight)
  const result = new Date(day)
  result.setHours(0, startMinutes + slotIndex * slotMinutes, 0, 0)
  return result
}
