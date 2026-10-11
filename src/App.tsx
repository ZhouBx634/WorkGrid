import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core'
import { Bell, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock3, GripVertical, ListChecks, Pause, Pencil, Play, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { addMinutes, format, isBefore, isSameDay, startOfDay } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { monthDays, monthLabel, moveAnchor, normalizeDropDate, taskIsVisible, taskStartsIn, viewTitle, weekDays } from './calendar'
import DataManagement from './components/DataManagement'
import CloudSync from './components/CloudSync'
import InstallApp from './components/InstallApp'
import CourseImport from './components/CourseImport'
import CalendarZoom from './components/CalendarZoom'
import LongTermPlans, { DeadlineStrip } from './components/LongTermPlans'
import TimeFields from './components/TimeFields'
import { duePlanReminders } from './plans'
import { DEFAULT_SLOT_HEIGHT, ZOOM_STORAGE_KEY, fitSlotHeight, focusedTimeRange, loadCalendarZoom, stepCalendarZoom, timeRangeLabel, type CalendarZoom as Zoom, type TimeRange } from './calendarZoom'
import { applyCourseImport, undoCourseImport, type CourseOccurrence } from './courseImport'
import { clearCourseRecovery, loadCourseRecovery, saveCourseRecovery } from './courseRecovery'
import { dueEndReminderTasks, dueReminderTasks, reminderLabel } from './reminders'
import { dropDateFromPosition, durationFromTimes, endFromDuration, parseDurationInput } from './scheduling'
import { recurrenceDates, recurrenceLabel } from './recurrence'
import { clearImportRecovery, loadImportRecovery, loadTasks, makeId, saveImportRecovery, saveTasks } from './storage'
import type { RecurrenceFrequency, RecurrenceRule, Task, TaskColor, TaskDraft, TaskStatus, ViewMode } from './types'

const COLORS: Array<{ value: TaskColor; label: string }> = [
  { value: 'red', label: '红色' }, { value: 'orange', label: '橙色' }, { value: 'yellow', label: '黄色' },
  { value: 'green', label: '绿色' }, { value: 'blue', label: '蓝色' }, { value: 'indigo', label: '靛色' }, { value: 'purple', label: '紫色' },
]
const VIEW_LABELS: Record<ViewMode, string> = { today: '今日', month: '月', week: '周', day: '日' }
const STATUS_LABELS: Record<TaskStatus, string> = { todo: '待办', 'in-progress': '进行中', completed: '已完成' }
const REMINDER_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: '不提醒' }, { value: 0, label: '开始时' }, { value: 5, label: '提前 5 分钟' },
  { value: 10, label: '提前 10 分钟' }, { value: 15, label: '提前 15 分钟' }, { value: 30, label: '提前 30 分钟' },
  { value: 60, label: '提前 1 小时' }, { value: 1440, label: '提前 1 天' },
]
const EMPTY_DRAFT: TaskDraft = { title: '', color: 'blue', duration: 60, tags: [] }
const SLOT_MINUTES = 15

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes % 60 === 0) return `${minutes / 60} 小时`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

function parseTags(value: string) {
  return [...new Set(value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 8).map((tag) => tag.slice(0, 24))
}

function toDateTimeLocal(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function fromDateTimeLocal(value: string) {
  if (!value) return null
  const date = new Date(value)
  date.setSeconds(0, 0)
  return date.toISOString()
}

function SelectionMark({ selected }: { selected: boolean }) {
  return <span className={`batch-checkbox${selected ? ' is-checked' : ''}`} aria-hidden="true">{selected && <Check size={12} />}</span>
}

function DroppableBacklog({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'backlog', data: { type: 'backlog' } })
  return <aside ref={setNodeRef} className={`task-panel${isOver ? ' is-over' : ''}`}>{children}</aside>
}

function TaskCard({ task, selected, batchMode, batchSelected, onSelect, onEdit }: {
  task: Task; selected: boolean; batchMode: boolean; batchSelected: boolean; onSelect: () => void; onEdit: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `task:${task.id}` })
  return (
    <article ref={setNodeRef} className={`task-card color-${task.color}${selected ? ' is-selected' : ''}${batchSelected ? ' is-batch-selected' : ''}${isDragging ? ' is-dragging' : ''}`} onClick={onSelect} aria-label={`${task.title}，${durationLabel(task.duration)}`} {...attributes} {...(!batchMode ? listeners : {})}>
      {batchMode ? <SelectionMark selected={batchSelected} /> : <span className="drag-handle" title="拖动方块"><GripVertical size={15} aria-hidden="true" /></span>}
      <div className="task-copy"><strong>{task.title}</strong><span><Clock3 size={13} />{durationLabel(task.duration)}</span>{task.tags.length > 0 && <div className="task-tags">{task.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}</div>
      {!batchMode && <button className="icon-button task-edit" type="button" aria-label={`编辑 ${task.title}`} title="编辑任务" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onEdit() }}><Pencil size={15} /></button>}
    </article>
  )
}

interface LaidOutTask { task: Task; lane: number; laneCount: number; top: number; height: number }

function layoutDayTasks(tasks: Task[], preview: { id: string; duration: number } | null, slotHeight: number, range: TimeRange): LaidOutTask[] {
  const dayStart = range.start
  const dayEnd = range.end
  const candidates = tasks.filter((task) => task.start).map((task) => {
    const start = new Date(task.start!)
    const startMinutes = start.getHours() * 60 + start.getMinutes()
    const duration = preview?.id === task.id ? preview.duration : task.duration
    return { task, startMinutes, endMinutes: startMinutes + duration, duration }
  }).filter((item) => item.endMinutes > dayStart && item.startMinutes < dayEnd)
    .sort((left, right) => left.startMinutes - right.startMinutes || right.duration - left.duration)
  const result: LaidOutTask[] = []
  let index = 0
  while (index < candidates.length) {
    const group = [candidates[index]]
    let groupEnd = candidates[index].endMinutes
    let next = index + 1
    while (next < candidates.length && candidates[next].startMinutes < groupEnd) {
      group.push(candidates[next]); groupEnd = Math.max(groupEnd, candidates[next].endMinutes); next += 1
    }
    const laneEnds: number[] = []
    const assignments = group.map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.startMinutes)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = item.endMinutes
      return { item, lane }
    })
    assignments.forEach(({ item, lane }) => {
      const visibleStart = Math.max(item.startMinutes, dayStart)
      const visibleEnd = Math.min(item.endMinutes, dayEnd)
      const height = Math.min(((dayEnd - visibleStart) / SLOT_MINUTES) * slotHeight, Math.max(slotHeight, ((visibleEnd - visibleStart) / SLOT_MINUTES) * slotHeight))
      result.push({ task: item.task, lane, laneCount: laneEnds.length, top: ((visibleStart - dayStart) / SLOT_MINUTES) * slotHeight, height })
    })
    index = next
  }
  return result
}

function TimeSlot({ slot, onClick }: { slot: Date; onClick: () => void }) {
  return <div className="drop-slot" role="button" tabIndex={0} aria-label={`${format(slot, 'M 月 d 日 HH:mm')} 时间格`} onClick={onClick} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onClick() }} />
}

interface DragGuide { day: string; slot: Date; top: number }

function DroppableDayTrack({ day, guide, children }: { day: Date; guide: DragGuide | null; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.toISOString()}`, data: { type: 'day', day: day.toISOString() } })
  const visibleGuide = guide?.day === day.toISOString() ? guide : null
  const guideTime = visibleGuide ? format(visibleGuide.slot, 'HH:mm') : null
  return <div ref={setNodeRef} className={`day-track${isOver ? ' is-over' : ''}`} data-day={day.toISOString()}>{children}{visibleGuide && <div className="drag-time-guide" style={{ top: visibleGuide.top }} data-time={guideTime} aria-hidden="true"><span>{guideTime}</span></div>}</div>
}

function CalendarEvent({ item, duration, isResizing, batchMode, batchSelected, onOpen, onToggleBatch, onStatus, onResize }: {
  item: LaidOutTask; duration: number; isResizing: boolean; batchMode: boolean; batchSelected: boolean; onOpen: () => void; onToggleBatch: () => void; onStatus: (status: TaskStatus) => void; onResize: (event: React.PointerEvent) => void
}) {
  const { task } = item
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: `task:${task.id}` })
  const start = new Date(task.start!)
  const end = addMinutes(start, duration)
  const style = { top: item.top, height: item.height, left: `calc(${(item.lane / item.laneCount) * 100}% + 3px)`, width: `calc(${100 / item.laneCount}% - 6px)` }
  return (
    <article ref={setNodeRef} className={`calendar-event color-${task.color} status-${task.status}${item.height < 42 ? ' is-compact' : ''}${item.height < 30 ? ' is-tiny' : ''}${batchMode ? ' is-batch-mode' : ''}${batchSelected ? ' is-batch-selected' : ''}${isDragging ? ' is-dragging' : ''}`} style={style} title={`${task.title} · ${format(start, 'HH:mm')} - ${format(end, 'HH:mm')}`} aria-label={`${task.title}，${STATUS_LABELS[task.status]}，${format(start, 'HH:mm')} 至 ${format(end, 'HH:mm')}`} onClick={(event) => { event.stopPropagation(); batchMode ? onToggleBatch() : onOpen() }} {...attributes} {...(!batchMode ? listeners : {})}>
      {batchMode && <SelectionMark selected={batchSelected} />}
      {!batchMode && <button ref={setActivatorNodeRef} type="button" className="event-move-handle" aria-label={`拖动移动 ${task.title}`} title="按住拖动移动日程" onMouseDown={(event) => { event.stopPropagation(); listeners?.onMouseDown?.(event) }} onTouchStart={(event) => { event.stopPropagation(); listeners?.onTouchStart?.(event) }} onClick={(event) => { event.preventDefault(); event.stopPropagation() }}><GripVertical size={14} aria-hidden="true" /></button>}
      <div className="event-main"><strong>{task.title}</strong><span>{format(start, 'HH:mm')} - {format(end, 'HH:mm')}</span>{task.calendarImport && <small className="course-event-details" title={[task.calendarImport.location, task.calendarImport.teacher, task.calendarImport.teachingClass].filter(Boolean).join(' · ')}>{[task.calendarImport.location, task.calendarImport.teacher].filter(Boolean).join(' · ')}</small>}</div>
      {!batchMode && <div className="event-actions" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>{task.status === 'completed' ? <button type="button" aria-label="重新打开" title="重新打开" onClick={() => onStatus('todo')}><RotateCcw size={13} /></button> : <><button type="button" aria-label={task.status === 'in-progress' ? '暂停' : '开始'} title={task.status === 'in-progress' ? '暂停' : '开始'} onClick={() => onStatus(task.status === 'in-progress' ? 'todo' : 'in-progress')}>{task.status === 'in-progress' ? <Pause size={13} /> : <Play size={13} />}</button><button type="button" aria-label="完成" title="完成" onClick={() => onStatus('completed')}><Check size={14} /></button></>}</div>}
      {!batchMode && (item.height >= 42 || isResizing) && <button className="resize-handle" type="button" aria-label="调整时长" title="上下拖动调整时长" onPointerDown={onResize} onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation() }} />}
    </article>
  )
}

function MonthCell({ day, className, children, onSchedule }: { day: Date; className: string; children: React.ReactNode; onSchedule: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `month:${day.toISOString()}`, data: { type: 'slot', slot: day.toISOString() } })
  return <div ref={setNodeRef} className={`${className}${isOver ? ' is-over' : ''}`} onClick={onSchedule} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSchedule() }}>{children}</div>
}

function MonthEvent({ task, batchMode, batchSelected, onOpen, onToggleBatch }: { task: Task; batchMode: boolean; batchSelected: boolean; onOpen: () => void; onToggleBatch: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `task:${task.id}` })
  return <button ref={setNodeRef} type="button" className={`month-event color-${task.color} status-${task.status}${batchSelected ? ' is-batch-selected' : ''}${isDragging ? ' is-dragging' : ''}`} onClick={(event) => { event.stopPropagation(); batchMode ? onToggleBatch() : onOpen() }} {...attributes} {...(!batchMode ? listeners : {})}>{batchMode && <SelectionMark selected={batchSelected} />}<span>{task.status === 'completed' && <Check size={11} />}{task.title}</span><small>{format(new Date(task.start!), 'HH:mm')}</small></button>
}

function dragStartY(event: Event) {
  if (event instanceof TouchEvent) return event.touches[0]?.clientY ?? event.changedTouches[0]?.clientY ?? null
  if (event instanceof MouseEvent) return event.clientY
  return null
}

interface UndoEntry {
  tasks: Task[]
  label: string
}

function App() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks)
  const [view, setView] = useState<ViewMode>('week')
  const [anchor, setAnchor] = useState(new Date())
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT)
  const [draftDuration, setDraftDuration] = useState('60')
  const [draftTags, setDraftTags] = useState('')
  const [draftStart, setDraftStart] = useState('')
  const [draftEnd, setDraftEnd] = useState('')
  const [draftTimeMode, setDraftTimeMode] = useState<'duration' | 'end'>('end')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanupRef.current?.(), [])
  const [editingDraft, setEditingDraft] = useState<TaskDraft>(EMPTY_DRAFT)
  const [editingDuration, setEditingDuration] = useState('60')
  const [editingStart, setEditingStart] = useState('')
  const [editingEnd, setEditingEnd] = useState('')
  const [editingTimeMode, setEditingTimeMode] = useState<'duration' | 'end'>('end')
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())
  const [editingStatus, setEditingStatus] = useState<TaskStatus>('todo')
  const [editingReminder, setEditingReminder] = useState<number | null>(null)
  const [editingEndReminder, setEditingEndReminder] = useState(false)
  const [editingTags, setEditingTags] = useState('')
  const [editingFrequency, setEditingFrequency] = useState<RecurrenceFrequency | 'none'>('none')
  const [editingUntil, setEditingUntil] = useState('')
  const [editingWeekdays, setEditingWeekdays] = useState<number[]>([])
  const [editingScope, setEditingScope] = useState<'single' | 'series'>('single')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [batchTags, setBatchTags] = useState('')
  const [resizePreview, setResizePreview] = useState<{ id: string; duration: number } | null>(null)
  const [pendingSchedule, setPendingSchedule] = useState<{ taskId: string; slot: Date } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [canUndoImport, setCanUndoImport] = useState(() => loadImportRecovery() !== null)
  const [courseImportOpen, setCourseImportOpen] = useState(false)
  const [canUndoCourseImport, setCanUndoCourseImport] = useState(() => loadCourseRecovery() !== null)
  const [batchMode, setBatchMode] = useState(false)
  const [batchSelection, setBatchSelection] = useState<Set<string>>(new Set())
  const [dragGuide, setDragGuide] = useState<DragGuide | null>(null)
  const [dragPreviewOffsetY, setDragPreviewOffsetY] = useState(0)
  const [zoom, setZoom] = useState<Zoom>(loadCalendarZoom)
  const [overviewSlotHeight, setOverviewSlotHeight] = useState(DEFAULT_SLOT_HEIGHT / 4)
  const [isZoomAnimating, setIsZoomAnimating] = useState(false)
  const frozenFocusRangeRef = useRef<TimeRange>({ start: 0, end: 1440 })
  const focusReturnZoomRef = useRef<Zoom>(100)
  const zoomFocusMinutesRef = useRef<number | null>(null)
  const previousTimelineRef = useRef<{ slotHeight: number; rangeStart: number; scrollTop: number; zoom: Zoom; view: ViewMode; anchor: number } | null>(null)
  const calendarScrollRef = useRef<HTMLDivElement>(null)
  const tasksRef = useRef(tasks)
  const dragGuideRef = useRef<DragGuide | null>(null)
  const deliveredReminderKeys = useRef<Set<string>>(new Set())
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => saveTasks(tasks), [tasks])
  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer) }, [])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => { setToast(null); setUndoEntry(null) }, undoEntry ? 6000 : 2400)
    return () => window.clearTimeout(timer)
  }, [toast, undoEntry])
  useEffect(() => {
    try { localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom)) } catch { /* Zoom remains usable if storage is unavailable. */ }
  }, [zoom])
  useLayoutEffect(() => {
    const surface = calendarScrollRef.current
    if (view === 'month' || !surface) return
    function measureOverview() {
      if (!surface) return
      const maxHeight = Number.parseFloat(getComputedStyle(surface).maxHeight)
      const headerHeight = surface.querySelector('.timeline-header-corner')?.getBoundingClientRect().height ?? 56
      if (Number.isFinite(maxHeight)) setOverviewSlotHeight(fitSlotHeight(maxHeight, headerHeight))
    }
    measureOverview()
    const observer = new ResizeObserver(measureOverview)
    observer.observe(surface)
    window.addEventListener('resize', measureOverview)
    return () => { observer.disconnect(); window.removeEventListener('resize', measureOverview) }
  }, [view])
  useEffect(() => {
    function checkReminders() {
      const dueStarts = dueReminderTasks(tasks).filter((task) => {
        const key = `start:${task.id}:${task.start}:${task.reminderMinutes}`
        if (deliveredReminderKeys.current.has(key)) return false
        deliveredReminderKeys.current.add(key)
        return true
      })
      const dueEnds = dueEndReminderTasks(tasks).filter((task) => {
        const key = `end:${task.id}:${task.start}:${task.duration}`
        if (deliveredReminderKeys.current.has(key)) return false
        deliveredReminderKeys.current.add(key)
        return true
      })
      const duePlans = duePlanReminders(tasks).filter((task) => {
        const key = `plan:${task.id}:${task.planDefinition!.deadline}:${task.planDefinition!.reminderMinutes}`
        if (deliveredReminderKeys.current.has(key)) return false
        deliveredReminderKeys.current.add(key)
        return true
      })
      if (dueStarts.length === 0 && dueEnds.length === 0 && duePlans.length === 0) return
      setUndoEntry(null)
      const deliveredAt = new Date().toISOString()
      const startIds = new Set([...dueStarts, ...duePlans].map((task) => task.id))
      const endIds = new Set(dueEnds.map((task) => task.id))
      setTasks((current) => current.map((task) => ({
        ...task,
        remindedAt: startIds.has(task.id) ? deliveredAt : task.remindedAt,
        endRemindedAt: endIds.has(task.id) ? deliveredAt : task.endRemindedAt,
      })))
      if (duePlans.length === 1 && dueStarts.length === 0 && dueEnds.length === 0) setToast(`截止提醒：${duePlans[0].title}`)
      else if (dueEnds.length === 1 && dueStarts.length === 0) setToast(`结束提醒：${dueEnds[0].title}`)
      else if (dueStarts.length === 1 && dueEnds.length === 0) setToast(`开始提醒：${dueStarts[0].title}`)
      else setToast(`有 ${dueStarts.length + dueEnds.length + duePlans.length} 项工作提醒`)
      if ('Notification' in window && Notification.permission === 'granted') {
        dueStarts.forEach((task) => {
          try { new Notification('WorkGrid 开始提醒', { body: `${task.title} · ${task.start ? format(new Date(task.start), 'HH:mm') : ''}`, tag: `workgrid-start-${task.id}` }) } catch { /* 应用内提醒已经显示 */ }
        })
        dueEnds.forEach((task) => {
          try { new Notification('WorkGrid 结束提醒', { body: `${task.title} 的预计时间已结束`, tag: `workgrid-end-${task.id}` }) } catch { /* 应用内提醒已经显示 */ }
        })
        duePlans.forEach((task) => { try { new Notification('WorkGrid 截止提醒', { body: `${task.title} · ${toDateTimeLocal(task.planDefinition!.deadline).replace('T', ' ')}`, tag: `workgrid-plan-${task.id}` }) } catch { /* In-app reminder is already visible. */ } })
      }
    }
    checkReminders()
    const timer = window.setInterval(checkReminders, 30_000)
    return () => window.clearInterval(timer)
  }, [tasks])

  const activeTasks = useMemo(() => tasks.filter((task) => !task.deletedAt && !task.planDefinition), [tasks])
  const trashedTasks = useMemo(() => tasks.filter((task) => task.deletedAt).sort((left, right) => Date.parse(right.deletedAt!) - Date.parse(left.deletedAt!)), [tasks])
  const filteredTasks = useMemo(() => activeTasks.filter((task) => {
    const query = searchQuery.trim().toLocaleLowerCase()
    return (!query || task.title.toLocaleLowerCase().includes(query) || task.tags.some((tag) => tag.toLocaleLowerCase().includes(query)))
      && (statusFilter === 'all' || task.status === statusFilter)
      && (tagFilter === 'all' || task.tags.includes(tagFilter))
  }), [activeTasks, searchQuery, statusFilter, tagFilter])
  const unscheduled = useMemo(() => filteredTasks.filter((task) => !task.start && !task.planAllocation), [filteredTasks])
  const visibleTasks = useMemo(() => filteredTasks.filter((task) => taskIsVisible(task, anchor, view)), [filteredTasks, anchor, view])
  const allTags = useMemo(() => [...new Set(activeTasks.flatMap((task) => task.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [activeTasks])
  const selectedTask = activeTasks.find((task) => task.id === selectedTaskId) ?? null
  const activeTask = activeTasks.find((task) => task.id === draggingTaskId) ?? null
  const today = startOfDay(new Date())
  const todayTasks = filteredTasks.filter((task) => task.start && isSameDay(new Date(task.start), today))
  const completedTodayTasks = todayTasks.filter((task) => task.status === 'completed')
  const overdueTasks = filteredTasks.filter((task) => task.start && isBefore(new Date(task.start), today) && task.status !== 'completed')

  const focusedTasks = view === 'today' ? todayTasks : visibleTasks
  const candidateRange = focusedTimeRange(focusedTasks)
  // Keep the time-to-pixel mapping fixed throughout a drag or resize, including cloud updates.
  if (!draggingTaskId && !resizePreview) frozenFocusRangeRef.current = candidateRange
  const timeRange = zoom === 'focus' ? frozenFocusRangeRef.current : { start: 0, end: 1440 }
  const slotCount = (timeRange.end - timeRange.start) / SLOT_MINUTES
  const slotHeight = typeof zoom === 'number' ? DEFAULT_SLOT_HEIGHT * zoom / 100 : overviewSlotHeight * 96 / slotCount

  useLayoutEffect(() => {
    const surface = calendarScrollRef.current
    if (view === 'month' || !surface) { previousTimelineRef.current = null; return }
    const previous = previousTimelineRef.current
    const sameView = previous?.view === view && previous.anchor === anchor.getTime()
    if (typeof zoom !== 'number') surface.scrollTop = 0
    else if (!sameView) surface.scrollTop = 7.5 * 4 * slotHeight - 24
    else if (zoomFocusMinutesRef.current !== null) surface.scrollTop = zoomFocusMinutesRef.current / SLOT_MINUTES * slotHeight - (surface.clientHeight - 56) / 2
    else if (previous.slotHeight !== slotHeight) surface.scrollTop *= slotHeight / previous.slotHeight
    zoomFocusMinutesRef.current = null
    previousTimelineRef.current = { slotHeight, rangeStart: timeRange.start, scrollTop: surface.scrollTop, zoom, view, anchor: anchor.getTime() }
    const geometryChanged = previous && (previous.slotHeight !== slotHeight || previous.rangeStart !== timeRange.start)
    if (!sameView || !geometryChanged || (previous.zoom !== 'focus' && zoom !== 'focus') || draggingTaskId || resizePreview || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // Animate a visual-only transform; the final layout and all scheduling coordinates stay exact.
    const offset = (timeRange.start - previous.rangeStart) / SLOT_MINUTES * previous.slotHeight - previous.scrollTop + surface.scrollTop
    const scale = previous.slotHeight / slotHeight
    const timeline = surface.querySelector<HTMLElement>('.duration-timeline')!
    timeline.inert = true
    surface.dataset.zoomAnimating = 'true'
    setIsZoomAnimating(true)
    const animations = Array.from(surface.querySelectorAll<HTMLElement>('.day-track, .time-rail')).map((element) => element.animate([
      { transform: `translateY(${offset}px) scaleY(${scale})` },
      { transform: 'translateY(0px) scaleY(1)' },
    ], { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }))
    let active = true
    function unlock() {
      timeline.inert = false
      delete surface!.dataset.zoomAnimating
      setIsZoomAnimating(false)
    }
    void Promise.all(animations.map((animation) => animation.finished)).then(() => { if (active) unlock() }).catch(() => { /* Replacement transitions handle cancellation. */ })
    return () => { active = false; animations.forEach((animation) => animation.cancel()); unlock() }
  }, [slotHeight, timeRange.start, view, anchor, zoom, draggingTaskId, resizePreview?.id])

  function changeZoom(next: Zoom) {
    if (next === zoom) return
    const surface = calendarScrollRef.current
    if (surface) {
      zoomFocusMinutesRef.current = timeRange.start + (surface.scrollTop + (surface.clientHeight - 56) / 2) / slotHeight * SLOT_MINUTES
      if (previousTimelineRef.current) previousTimelineRef.current.scrollTop = surface.scrollTop
    }
    setZoom(next)
  }

  function toggleFocus() {
    if (zoom === 'focus') {
      changeZoom(focusReturnZoomRef.current)
      return
    }
    focusReturnZoomRef.current = zoom
    changeZoom('focus')
  }

  function notify(message: string) { setUndoEntry(null); setToast(message) }
  function commitTaskChange(label: string, message: string, update: (current: Task[]) => Task[]) {
    const current = tasksRef.current
    const next = update(current)
    if (next === current) return
    tasksRef.current = next
    setUndoEntry({ tasks: current, label })
    setTasks(next)
    setToast(message)
  }
  function undoLastChange() {
    if (!undoEntry) return
    tasksRef.current = undoEntry.tasks
    setTasks(undoEntry.tasks)
    setUndoEntry(null)
    setSelectedTaskId(null)
    setBatchSelection(new Set())
    setToast(`已撤销${undoEntry.label}`)
  }
  function replaceTasksFromExternal(value: React.SetStateAction<Task[]>) {
    setUndoEntry(null)
    setTasks((current) => {
      const next = typeof value === 'function' ? value(current) : value
      tasksRef.current = next
      return next
    })
  }
  function selectView(next: ViewMode) { setView(next); if (next === 'today') setAnchor(new Date()) }
  function updateStatus(taskId: string, status: TaskStatus) {
    commitTaskChange('状态修改', status === 'completed' ? '任务已完成' : status === 'in-progress' ? '任务已开始' : '任务已重新打开', (current) => current.map((task) => {
      if (status === 'in-progress' && task.id !== taskId && task.status === 'in-progress') return { ...task, status: 'todo', completedAt: null }
      if (task.id !== taskId) return task
      return { ...task, status, completedAt: status === 'completed' ? new Date().toISOString() : null }
    }))
  }
  function createTask(event: React.FormEvent) {
    event.preventDefault(); const title = draft.title.trim(); if (!title) return
    const duration = draftTimeMode === 'end' && draftStart ? durationFromTimes(draftStart, draftEnd) : parseDurationInput(draftDuration)
    if (duration === null) { notify('请填写有效时间：结束须晚于开始，时长为 1 至 720 分钟'); return }
    commitTaskChange('创建工作', draftStart ? '已创建并安排到日历' : '已创建工作方块', (current) => [{ id: makeId(), title, color: draft.color, duration, start: fromDateTimeLocal(draftStart), createdAt: new Date().toISOString(), status: 'todo', completedAt: null, reminderMinutes: null, remindedAt: null, endReminder: false, endRemindedAt: null, tags: parseTags(draftTags), deletedAt: null }, ...current])
    setDraft((current) => ({ ...current, title: '', duration, tags: [] })); setDraftDuration(String(duration)); setDraftTags(''); setDraftStart(''); setDraftEnd('')
  }
  function scheduleTask(taskId: string, slot: Date, reopenCompleted?: boolean) {
    const normalized = normalizeDropDate(slot, view)
    const moving = activeTasks.find((task) => task.id === taskId)
    if (moving?.status === 'completed' && reopenCompleted === undefined) { setPendingSchedule({ taskId, slot: normalized }); return }
    const movingEnd = moving ? addMinutes(normalized, moving.duration) : normalized
    const overlapping = activeTasks.some((task) => {
      if (task.id === taskId || !task.start) return false
      const start = new Date(task.start); return start < movingEnd && addMinutes(start, task.duration) > normalized
    })
    commitTaskChange('排期', overlapping ? '已安排，与其他工作时间重叠' : '已安排到日历', (current) => current.map((task) => task.id === taskId ? { ...task, start: normalized.toISOString(), remindedAt: null, endRemindedAt: null, status: reopenCompleted ? 'todo' : task.status, completedAt: reopenCompleted ? null : task.completedAt } : task))
    setSelectedTaskId(null)
  }
  function unscheduleTask(taskId: string) {
    commitTaskChange('移回待安排', '已移回待安排', (current) => current.map((task) => task.id === taskId ? { ...task, start: null, remindedAt: null, endRemindedAt: null, status: task.status === 'in-progress' ? 'todo' : task.status } : task))
    setSelectedTaskId(null)
  }
  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id)
    dragGuideRef.current = null
    setDragGuide(null)
    setDragPreviewOffsetY(0)
    if (id.startsWith('task:')) setDraggingTaskId(id.slice(5))
  }
  function dragSlotFromEvent(event: DragMoveEvent | DragEndEvent) {
    const target = event.over?.data.current as { type?: string; day?: string } | undefined
    if (target?.type !== 'day' || !target.day || !event.over) return null
    const initialY = dragStartY(event.activatorEvent)
    if (initialY === null) return null
    const track = calendarScrollRef.current?.querySelector<HTMLElement>(`.day-track[data-day="${CSS.escape(target.day)}"]`)
    const trackTop = track?.getBoundingClientRect().top ?? event.over.rect.top
    const previewTop = event.active.rect.current.translated?.top ?? initialY + event.delta.y
    return { day: target.day, trackTop, previewTop, slot: dropDateFromPosition(new Date(target.day), previewTop, trackTop, slotHeight, SLOT_MINUTES, timeRange.start, timeRange.end) }
  }
  function handleDragMove(event: DragMoveEvent) {
    const result = dragSlotFromEvent(event)
    if (!result) { dragGuideRef.current = null; setDragGuide(null); setDragPreviewOffsetY(0); return }
    const minutes = result.slot.getHours() * 60 + result.slot.getMinutes()
    const guideTop = ((minutes - timeRange.start) / SLOT_MINUTES) * slotHeight
    const guide = { day: result.day, slot: result.slot, top: guideTop }
    dragGuideRef.current = guide
    setDragGuide(guide)
    setDragPreviewOffsetY(result.trackTop + guideTop - result.previewTop)
  }
  function handleDragEnd(event: DragEndEvent) {
    const taskId = String(event.active.id).replace(/^task:/, '')
    const target = event.over?.data.current as { type?: string; slot?: string; day?: string } | undefined
    const lastGuide = dragGuideRef.current
    setDraggingTaskId(null)
    dragGuideRef.current = null
    setDragGuide(null)
    setDragPreviewOffsetY(0)
    if (!event.over || !target) return
    if (target.type === 'backlog') unscheduleTask(taskId)
    if (target.type === 'slot' && target.slot) scheduleTask(taskId, new Date(target.slot))
    if (target.type === 'day' && target.day) {
      const result = dragSlotFromEvent(event)
      const slot = result?.slot ?? (lastGuide?.day === target.day ? lastGuide.slot : null)
      if (slot) scheduleTask(taskId, slot)
    }
  }
  function beginEdit(task: Task) {
    setEditingTaskId(task.id); setEditingDraft({ title: task.title, color: task.color, duration: task.duration, tags: task.tags }); setEditingTags(task.tags.join(', ')); setEditingDuration(String(task.duration))
    setEditingStart(toDateTimeLocal(task.start)); setEditingStatus(task.status); setEditingReminder(task.reminderMinutes); setEditingEndReminder(task.endReminder)
    setEditingEnd(endFromDuration(toDateTimeLocal(task.start), String(task.duration))); setEditingTimeMode('end')
    setEditingFrequency(task.recurrence?.frequency ?? 'none'); setEditingUntil(task.recurrence?.until?.slice(0, 10) ?? ''); setEditingWeekdays(task.recurrence?.weekdays ?? []); setEditingScope(task.seriesId ? 'series' : 'single')
  }
  async function saveEdit(event: React.FormEvent) {
    event.preventDefault(); if (!editingTaskId || !editingDraft.title.trim()) return
    const duration = editingTimeMode === 'end' && editingStart ? durationFromTimes(editingStart, editingEnd) : parseDurationInput(editingDuration)
    if (duration === null) { notify('请填写有效时间：结束须晚于开始，时长为 1 至 720 分钟'); return }
    if ((editingReminder !== null || editingEndReminder) && editingStart && 'Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission() } catch { /* 应用内提醒仍然可用 */ }
    }
    const message = (editingReminder !== null || editingEndReminder) && editingStart && (!('Notification' in window) || Notification.permission !== 'granted') ? '修改已保存，将使用应用内提醒' : '修改已保存'
    const linkedPlan = tasksRef.current.find((task) => task.id === editingTaskId)?.planAllocation
    const rule: RecurrenceRule | null = linkedPlan || editingFrequency === 'none' || !editingStart ? null : { frequency: editingFrequency, until: editingUntil || editingStart.slice(0, 10), ...(editingFrequency === 'weekly' ? { weekdays: editingWeekdays.length ? editingWeekdays : [new Date(editingStart).getDay()] } : {}) }
    commitTaskChange(rule ? '设置重复日程' : '编辑工作', rule ? `已设置重复：${recurrenceLabel(rule)}` : message, (current) => {
      const source = current.find((task) => task.id === editingTaskId)
      if (!source) return current
      const baseUpdate = (task: Task, start: string | null, seriesId: string | null, recurrence: RecurrenceRule | null): Task => ({ ...task, ...editingDraft, tags: parseTags(editingTags), duration, title: editingDraft.title.trim(), start, status: editingStatus, completedAt: editingStatus === 'completed' ? task.completedAt ?? new Date().toISOString() : null, reminderMinutes: editingReminder, remindedAt: start !== task.start || editingReminder !== task.reminderMinutes ? null : task.remindedAt, endReminder: editingEndReminder, endRemindedAt: start !== task.start || duration !== task.duration || editingEndReminder !== task.endReminder ? null : task.endRemindedAt, seriesId, recurrence })
      if (rule && (editingScope === 'series' || !source.seriesId)) {
        const seriesId = source.seriesId ?? source.id
        const dates = recurrenceDates(new Date(editingStart), rule)
        const existing = current.filter((task) => task.seriesId === seriesId || task.id === editingTaskId)
        const keep = current.filter((task) => !(task.seriesId === seriesId || task.id === editingTaskId))
        const generated = dates.map((date, index) => {
          const old = existing[index]
          return baseUpdate(old ?? { ...source, id: makeId(), createdAt: new Date().toISOString() }, date.toISOString(), seriesId, rule)
        })
        return [...generated, ...keep]
      }
      return current.map((task) => {
      if (editingStatus === 'in-progress' && task.id !== editingTaskId && task.status === 'in-progress') return { ...task, status: 'todo', completedAt: null }
      if (task.id !== editingTaskId) return task
      const start = fromDateTimeLocal(editingStart)
      return baseUpdate(task, start, rule ? (task.seriesId ?? task.id) : task.seriesId ?? null, rule)
    }) })
    setEditingTaskId(null)
  }
  function deleteEditingTask() {
    if (!editingTaskId) return
    const deletedAt = new Date().toISOString()
    const linked = tasksRef.current.find((task) => task.id === editingTaskId)?.planAllocation
    commitTaskChange(linked ? '移回计划' : '删除工作', linked ? '该节已归还计划的待安排区，可重新拖入日历' : '已移入回收站', (current) => current.map((task) => task.id === editingTaskId ? linked ? { ...task, start: null, deletedAt: null, status: 'todo', completedAt: null, remindedAt: null, endRemindedAt: null } : { ...task, deletedAt } : task))
    setSelectedTaskId((current) => current === editingTaskId ? null : current); setEditingTaskId(null)
  }
  function importTasks(nextTasks: Task[], message: string) {
    try { saveImportRecovery(tasks); saveTasks(nextTasks); replaceTasksFromExternal(nextTasks); setSelectedTaskId(null); setEditingTaskId(null); setCanUndoImport(true); notify(message); return true }
    catch { notify('浏览器存储空间不足，导入未完成'); return false }
  }
  function undoLastImport() {
    const recovery = loadImportRecovery(); if (!recovery) { setCanUndoImport(false); notify('没有可恢复的导入记录'); return }
    try { saveTasks(recovery); replaceTasksFromExternal(recovery); clearImportRecovery(); setCanUndoImport(false); setSelectedTaskId(null); notify('已撤销上次导入') }
    catch { notify('恢复失败，当前数据未改变') }
  }
  function importCourses(courses: CourseOccurrence[], updateKeys: Set<string>, reviewedTasks: string) {
    const current = tasksRef.current
    if (JSON.stringify(current) !== reviewedTasks) { notify('日程已变化，请重新核对课表预览后确认'); return false }
    const result = applyCourseImport(current, courses, updateKeys)
    if (!result.changes.length) { notify('课程已导入，无需重复添加'); return false }
    const previousRecovery = loadCourseRecovery()
    try {
      saveCourseRecovery(result.changes)
      saveTasks(result.tasks)
    } catch {
      try { previousRecovery ? saveCourseRecovery(previousRecovery) : clearCourseRecovery() } catch { /* Current schedules remain unchanged. */ }
      notify('浏览器存储空间不足，课表导入未完成，原日程保留')
      return false
    }
    replaceTasksFromExternal(result.tasks)
    setCanUndoCourseImport(true)
    notify(`课表已导入：新增 ${result.added} 节，更新 ${result.updated} 节，原有日程保留`)
    return true
  }
  function undoLastCourseImport() {
    const recovery = loadCourseRecovery()
    if (!recovery) { setCanUndoCourseImport(false); notify('没有可撤销的课表导入'); return }
    const result = undoCourseImport(tasksRef.current, recovery)
    try { saveTasks(result.tasks) }
    catch { notify('撤销失败，当前日程未改变'); return }
    replaceTasksFromExternal(result.tasks)
    try { clearCourseRecovery() } catch { /* Repeating undo will not touch unrelated tasks. */ }
    setCanUndoCourseImport(false)
    notify(`已撤销 ${result.reverted} 节课程${result.skipped ? `，保留 ${result.skipped} 节导入后修改的课程` : ''}，其他日程保留`)
  }
  function moveToToday(taskId: string) {
    commitTaskChange('移到今天', '已移到今天', (current) => current.map((task) => {
      if (task.id !== taskId || !task.start) return task
      const old = new Date(task.start); const next = new Date(); next.setHours(old.getHours(), old.getMinutes(), 0, 0)
      return { ...task, start: next.toISOString(), status: 'todo', completedAt: null, remindedAt: null, endRemindedAt: null }
    }))
  }
  function moveAllOverdue() {
    const ids = new Set(overdueTasks.map((task) => task.id))
    commitTaskChange('批量移到今天', `已将 ${ids.size} 项工作移到今天`, (current) => current.map((task) => {
      if (!ids.has(task.id) || !task.start) return task
      const old = new Date(task.start); const next = new Date(); next.setHours(old.getHours(), old.getMinutes(), 0, 0)
      return { ...task, start: next.toISOString(), status: 'todo', completedAt: null, remindedAt: null, endRemindedAt: null }
    }))
  }
  function startResize(event: React.PointerEvent, task: Task) {
    if (event.pointerType === 'touch' || event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); resizeCleanupRef.current?.()
    const startY = event.clientY; const original = task.duration; const pointerId = event.pointerId
    const handle = event.currentTarget as HTMLElement
    try { handle.setPointerCapture(pointerId) } catch { /* Synthetic events have no active pointer. */ }
    setResizePreview({ id: task.id, duration: original })
    const suppressClick = (click: MouseEvent) => {
      if (click.target instanceof Element && click.target.closest('.calendar-event')) { click.preventDefault(); click.stopImmediatePropagation() }
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel)
      try { if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId) } catch { /* The pointer may already be released. */ }
    }
    const finish = () => {
      cleanup(); setResizePreview(null)
      // The browser's click follows pointerup; keep the guard until that event has finished.
      const timer = window.setTimeout(() => { window.removeEventListener('click', suppressClick, true); resizeCleanupRef.current = null }, 0)
      resizeCleanupRef.current = () => { window.clearTimeout(timer); window.removeEventListener('click', suppressClick, true) }
    }
    const onMove = (moveEvent: PointerEvent) => { if (moveEvent.pointerId !== pointerId) return; const slots = Math.round((moveEvent.clientY - startY) / slotHeight); setResizePreview({ id: task.id, duration: slots === 0 ? original : Math.max(15, Math.min(720, original + slots * SLOT_MINUTES)) }) }
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      const slots = Math.round((upEvent.clientY - startY) / slotHeight); const duration = slots === 0 ? original : Math.max(15, Math.min(720, original + slots * SLOT_MINUTES))
      if (duration !== original) commitTaskChange('时长调整', `时长已调整为 ${durationLabel(duration)}`, (current) => current.map((item) => item.id === task.id ? { ...item, duration, endRemindedAt: null } : item))
      finish()
    }
    const onCancel = (cancelEvent: PointerEvent) => { if (cancelEvent.pointerId === pointerId) finish() }
    window.addEventListener('click', suppressClick, true)
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onCancel)
    resizeCleanupRef.current = () => { cleanup(); window.removeEventListener('click', suppressClick, true) }
  }
  function toggleBatchMode() { setBatchMode((current) => !current); setBatchSelection(new Set()); setSelectedTaskId(null) }
  function toggleBatchTask(taskId: string) { setBatchSelection((current) => { const next = new Set(current); next.has(taskId) ? next.delete(taskId) : next.add(taskId); return next }) }
  function batchSetStatus(status: TaskStatus) {
    if (batchSelection.size === 0) return
    commitTaskChange('批量状态修改', `已更新 ${batchSelection.size} 项工作的状态`, (current) => current.map((task) => batchSelection.has(task.id) ? { ...task, status, completedAt: status === 'completed' ? new Date().toISOString() : null } : task))
  }
  function batchSetColor(color: TaskColor) {
    if (batchSelection.size === 0) return
    commitTaskChange('批量颜色修改', `已更新 ${batchSelection.size} 项工作的颜色`, (current) => current.map((task) => batchSelection.has(task.id) ? { ...task, color } : task))
  }
  function batchSetTags() {
    const tags = parseTags(batchTags)
    if (batchSelection.size === 0 || tags.length === 0) return
    commitTaskChange('批量添加标签', `已为 ${batchSelection.size} 项工作添加标签`, (current) => current.map((task) => batchSelection.has(task.id) ? { ...task, tags: [...new Set([...task.tags, ...tags])].slice(0, 8) } : task))
    setBatchTags('')
  }
  function batchSetStartReminder(value: string) {
    if (batchSelection.size === 0) return
    const reminderMinutes = value === 'none' ? null : Number(value)
    commitTaskChange('批量开始提醒修改', `已更新 ${batchSelection.size} 项工作的开始提醒`, (current) => current.map((task) => batchSelection.has(task.id) ? { ...task, reminderMinutes, remindedAt: null } : task))
  }
  function batchSetEndReminder(value: string) {
    if (batchSelection.size === 0) return
    const endReminder = value === 'on'
    commitTaskChange('批量结束提醒修改', `已更新 ${batchSelection.size} 项工作的结束提醒`, (current) => current.map((task) => batchSelection.has(task.id) ? { ...task, endReminder, endRemindedAt: null } : task))
  }
  function batchDelete() {
    if (batchSelection.size === 0 || !window.confirm(`将选中的 ${batchSelection.size} 项工作移入回收站吗？`)) return
    const count = batchSelection.size
    const deletedAt = new Date().toISOString()
    commitTaskChange('批量删除', `已处理 ${count} 项工作，计划日程归还待安排，其余移入回收站`, (current) => current.map((task) => batchSelection.has(task.id) ? task.planAllocation ? { ...task, start: null, deletedAt: null, status: 'todo', completedAt: null, remindedAt: null, endRemindedAt: null } : { ...task, deletedAt } : task))
    setBatchSelection(new Set())
  }
  function restoreTask(taskId: string) {
    commitTaskChange('恢复工作', '工作已恢复', (current) => current.map((task) => task.id === taskId ? { ...task, deletedAt: null } : task))
  }
  function permanentlyDeleteTask(taskId: string) {
    const task = trashedTasks.find((item) => item.id === taskId)
    if (!task || !window.confirm(`永久删除“${task.title}”吗？此操作无法撤销。`)) return
    const next = tasksRef.current.filter((item) => item.id !== taskId)
    tasksRef.current = next
    setUndoEntry(null)
    setTasks(next)
    setToast('工作已永久删除')
  }
  function emptyTrash() {
    if (trashedTasks.length === 0 || !window.confirm(`永久删除回收站中的 ${trashedTasks.length} 项工作吗？此操作无法撤销。`)) return
    const next = tasksRef.current.filter((task) => !task.deletedAt)
    tasksRef.current = next
    setUndoEntry(null)
    setTasks(next)
    setToast('回收站已清空')
  }

  function renderTimeline(days: Date[]) {
    const slots = Array.from({ length: slotCount }, (_, index) => index)
    return <div className="duration-timeline" data-range-start={timeRange.start} data-range-end={timeRange.end} aria-busy={isZoomAnimating} style={{ '--day-count': days.length, '--slot-height': `${slotHeight}px`, '--slot-count': slotCount } as React.CSSProperties}>
      <div className="timeline-header-corner" />
      {days.map((day) => <div className={`day-heading${isSameDay(day, new Date()) ? ' is-today' : ''}`} key={`heading-${day.toISOString()}`}><span>{format(day, 'EEE', { locale: zhCN })}</span><strong>{format(day, 'd')}</strong></div>)}
      <div className="time-rail">{Array.from({ length: (timeRange.end - timeRange.start) / 60 + 1 }, (_, index) => <span key={index} style={{ top: index * slotHeight * 4 }} hidden={slotHeight < 6 && index % 2 !== 0 && index !== (timeRange.end - timeRange.start) / 60}>{String(timeRange.start / 60 + index).padStart(2, '0')}:00</span>)}</div>
      {days.map((day) => {
        const layout = layoutDayTasks(filteredTasks.filter((task) => task.start && isSameDay(new Date(task.start), day)), resizePreview, slotHeight, timeRange)
        return <DroppableDayTrack day={day} guide={dragGuide} key={day.toISOString()}><div className="drop-slots">{slots.map((slotIndex) => { const slot = new Date(day); slot.setHours(0, timeRange.start + slotIndex * SLOT_MINUTES, 0, 0); return <TimeSlot key={slotIndex} slot={slot} onClick={() => selectedTaskId && scheduleTask(selectedTaskId, slot)} /> })}</div><div className="event-layer">{layout.map((item) => <CalendarEvent key={item.task.id} item={item} duration={resizePreview?.id === item.task.id ? resizePreview.duration : item.task.duration} isResizing={resizePreview?.id === item.task.id} batchMode={batchMode} batchSelected={batchSelection.has(item.task.id)} onOpen={() => beginEdit(item.task)} onToggleBatch={() => toggleBatchTask(item.task.id)} onStatus={(status) => updateStatus(item.task.id, status)} onResize={(event) => startResize(event, item.task)} />)}</div></DroppableDayTrack>
      })}
    </div>
  }
  function renderMonth() {
    const days = monthDays(anchor)
    return <div className="month-view"><div className="month-weekdays">{['一','二','三','四','五','六','日'].map((day) => <span key={day}>周{day}</span>)}</div><div className="month-grid">{days.map((day) => {
      const label = monthLabel(day, anchor); const dayTasks = filteredTasks.filter((task) => taskStartsIn(task, day, 'month'))
      return <MonthCell day={day} className={`month-cell${label.isOutside ? ' is-outside' : ''}${isSameDay(day, new Date()) ? ' is-today' : ''}`} key={day.toISOString()} onSchedule={() => selectedTaskId && scheduleTask(selectedTaskId, day)}><span className="month-date">{label.day}</span><div className="month-events">{dayTasks.slice(0, 3).map((task) => <MonthEvent key={task.id} task={task} batchMode={batchMode} batchSelected={batchSelection.has(task.id)} onOpen={() => beginEdit(task)} onToggleBatch={() => toggleBatchTask(task.id)} />)}{dayTasks.length > 3 && <button type="button" className="more-events" onClick={(event) => { event.stopPropagation(); setAnchor(day); setView('day') }}>+{dayTasks.length - 3} 项</button>}</div></MonthCell>
    })}</div></div>
  }
  function renderToday() {
    const completedMinutes = completedTodayTasks.reduce((sum, task) => sum + task.duration, 0)
    const plannedMinutes = todayTasks.reduce((sum, task) => sum + task.duration, 0)
    return <><div className="today-stats"><div><span>已完成</span><strong>{completedTodayTasks.length} / {todayTasks.length} 项</strong></div><div><span>计划时间</span><strong>{durationLabel(plannedMinutes)}</strong></div><div><span>完成时间</span><strong>{durationLabel(completedMinutes)}</strong></div></div>{overdueTasks.length > 0 && <section className="overdue-section"><div className="overdue-heading"><div><h3>以前未完成</h3><span>{overdueTasks.length} 项需要重新安排</span></div><button className="secondary-button" type="button" onClick={moveAllOverdue}>全部移到今天</button></div><div className="overdue-list">{overdueTasks.map((task) => <div className={`overdue-item color-${task.color}`} key={task.id}><span className="overdue-dot" /><div><strong>{task.title}</strong><small>{format(new Date(task.start!), 'M 月 d 日 HH:mm')} · {durationLabel(task.duration)}</small></div><button type="button" onClick={() => moveToToday(task.id)}>移到今天</button></div>)}</div></section>}<div ref={calendarScrollRef} className="calendar-surface today-timeline">{renderTimeline([today])}</div></>
  }
  function calendarBody() {
    if (view === 'month') return <div className="calendar-surface">{renderMonth()}</div>
    const body = view === 'today' ? renderToday() : <div ref={calendarScrollRef} className={`calendar-surface${view === 'day' ? ' view-day' : ''}`}>{renderTimeline(view === 'week' ? weekDays(anchor) : [anchor])}</div>
    return <><CalendarZoom zoom={zoom} rangeLabel={timeRangeLabel(timeRange)} empty={focusedTasks.length === 0} disabled={draggingTaskId !== null || resizePreview !== null} onStep={(direction) => changeZoom(stepCalendarZoom(zoom, slotHeight, direction))} onChange={changeZoom} onToggleFocus={toggleFocus} />{body}</>
  }

  function renderPlanTask(task: Task) {
    return <TaskCard key={task.id} task={task} selected={selectedTaskId === task.id} batchMode={batchMode} batchSelected={batchSelection.has(task.id)} onSelect={() => batchMode ? toggleBatchTask(task.id) : setSelectedTaskId((current) => current === task.id ? null : task.id)} onEdit={() => beginEdit(task)} />
  }
  const totalMinutes = visibleTasks.reduce((sum, task) => sum + task.duration, 0)
  return <DndContext sensors={sensors} collisionDetection={pointerWithin} autoScroll={false} onDragStart={handleDragStart} onDragMove={handleDragMove} onDragEnd={handleDragEnd} onDragCancel={() => { dragGuideRef.current = null; setDraggingTaskId(null); setDragGuide(null); setDragPreviewOffsetY(0) }}>
    <div className="app-shell">
      {editingTaskId && <div className="recurrence-panel" aria-label="重复日程设置"><label htmlFor="edit-frequency">重复</label><select id="edit-frequency" value={editingFrequency} disabled={!editingStart || !!tasks.find((task) => task.id === editingTaskId)?.planAllocation} onChange={(event) => setEditingFrequency(event.target.value as RecurrenceFrequency | 'none')}><option value="none">不重复</option><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option><option value="monthly">每月</option></select>{editingFrequency !== 'none' && <><label htmlFor="edit-until">重复到</label><input id="edit-until" type="date" min={editingStart.slice(0, 10)} value={editingUntil || editingStart.slice(0, 10)} onChange={(event) => setEditingUntil(event.target.value)} />{editingFrequency === 'weekly' && <div className="weekday-picker" aria-label="重复星期">{['日','一','二','三','四','五','六'].map((label, day) => <button key={day} type="button" className={editingWeekdays.includes(day) ? 'is-active' : ''} onClick={() => setEditingWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day])}>周{label}</button>)}</div>}{tasks.find((task) => task.id === editingTaskId)?.seriesId && <div className="scope-picker"><button type="button" className={editingScope === 'single' ? 'is-active' : ''} onClick={() => setEditingScope('single')}>仅本次</button><button type="button" className={editingScope === 'series' ? 'is-active' : ''} onClick={() => setEditingScope('series')}>整个系列</button></div>}</>}</div>}
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><CalendarDays size={18} /></span><span>WorkGrid</span></div>
        <div className="view-switcher" role="group" aria-label="日历视图">{(Object.keys(VIEW_LABELS) as ViewMode[]).map((mode) => <button key={mode} type="button" className={view === mode ? 'is-active' : ''} onClick={() => selectView(mode)}>{VIEW_LABELS[mode]}</button>)}</div>
        <div className="date-controls">
          <InstallApp /><CloudSync tasks={tasks} setTasks={replaceTasksFromExternal} onNotify={notify} /><DataManagement tasks={tasks} canUndoImport={canUndoImport} onImport={importTasks} onUndoImport={undoLastImport} onNotify={notify} onOpenCourseImport={() => setCourseImportOpen(true)} canUndoCourseImport={canUndoCourseImport} onUndoCourseImport={undoLastCourseImport} />
          <button className="icon-button trash-button" type="button" aria-label={`回收站，${trashedTasks.length} 项`} title="回收站" onClick={() => setTrashOpen(true)}><Trash2 size={17} />{trashedTasks.length > 0 && <span>{trashedTasks.length > 99 ? '99+' : trashedTasks.length}</span>}</button>
          <span className="toolbar-divider" />
          {view !== 'today' && <><button className="icon-button" type="button" aria-label="上一周期" title="上一周期" onClick={() => setAnchor((date) => moveAnchor(date, view, -1))}><ChevronLeft size={18} /></button><button className="today-button" type="button" aria-label={`回到今天，当前选择 ${format(anchor, view === 'month' ? 'yyyy 年 M 月' : 'M 月 d 日')}`} onClick={() => setAnchor(new Date())}>{isSameDay(anchor, new Date()) ? '今天' : format(anchor, view === 'month' ? 'M 月' : 'M 月 d 日')}</button><button className="icon-button" type="button" aria-label="下一周期" title="下一周期" onClick={() => setAnchor((date) => moveAnchor(date, view, 1))}><ChevronRight size={18} /></button></>}
        </div>
      </header>
      {courseImportOpen && <CourseImport tasks={tasks} canUndo={canUndoCourseImport} onApply={importCourses} onUndo={undoLastCourseImport} onClose={() => setCourseImportOpen(false)} />}
      <DeadlineStrip tasks={tasks} now={now} onOpen={(plan) => setEditingPlanId(plan.id)} />
      <div className="workspace">
        <DroppableBacklog>
          <div className="panel-heading"><div><h1>待安排</h1><span>{unscheduled.length} 个方块</span></div>{selectedTask && !batchMode && <button className="clear-selection" type="button" onClick={() => setSelectedTaskId(null)}><X size={14} />取消选择</button>}</div>
          <form className="task-form" onSubmit={createTask}>
            <label className="sr-only" htmlFor="task-title">工作内容</label>
            <div className="input-row"><input id="task-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="输入工作内容" maxLength={60} /><button className="primary-icon-button" type="submit" aria-label="创建工作方块" title="创建工作方块"><Plus size={18} /></button></div>
            <TimeFields prefix="task" start={draftStart} duration={draftDuration} end={draftEnd} mode={draftTimeMode} onStart={setDraftStart} onDuration={setDraftDuration} onEnd={setDraftEnd} onMode={setDraftTimeMode} />
            <label className="field-label" htmlFor="task-tags">标签（逗号分隔）</label>
            <input id="task-tags" value={draftTags} onChange={(event) => setDraftTags(event.target.value)} placeholder="例如：客户，重要" maxLength={200} />
            <div className="color-field"><span className="field-label">颜色</span><div className="color-picker" role="group" aria-label="方块颜色">{COLORS.map((color) => <button key={color.value} className={`color-swatch color-${color.value}`} type="button" aria-label={color.label} aria-pressed={draft.color === color.value} title={color.label} onClick={() => setDraft((current) => ({ ...current, color: color.value }))}>{draft.color === color.value && <Check size={12} />}</button>)}</div></div>
          </form>
          <LongTermPlans tasks={tasks} commit={commitTaskChange} notify={notify} renderTask={renderPlanTask} editingPlan={tasks.find((task) => task.id === editingPlanId && task.planDefinition) ?? null} onEditPlan={(plan) => setEditingPlanId(plan?.id ?? null)} now={now} />
          <div className="filter-bar">
            <div className="search-field"><Search size={15} aria-hidden="true" /><input aria-label="搜索工作" placeholder="搜索工作或标签" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></div>
            <div className="filter-selects"><select aria-label="按状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">全部状态</option><option value="todo">待办</option><option value="in-progress">进行中</option><option value="completed">已完成</option></select><select aria-label="按标签筛选" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="all">全部标签</option>{allTags.map((tag) => <option value={tag} key={tag}>{tag}</option>)}</select></div>
          </div>
          <div className="task-list" aria-live="polite">{unscheduled.map((task) => <TaskCard key={task.id} task={task} selected={selectedTaskId === task.id} batchMode={batchMode} batchSelected={batchSelection.has(task.id)} onSelect={() => batchMode ? toggleBatchTask(task.id) : setSelectedTaskId((current) => current === task.id ? null : task.id)} onEdit={() => beginEdit(task)} />)}{unscheduled.length === 0 && <div className="empty-state"><Check size={20} /><span>{activeTasks.some((task) => !task.start) ? '没有匹配的工作' : '工作已全部安排'}</span></div>}</div>
        </DroppableBacklog>
        <main className="calendar-panel"><div className="calendar-heading"><div><h2>{viewTitle(view === 'today' ? today : anchor, view)}</h2><span>{view === 'today' ? '聚焦今天的工作执行' : format(anchor, 'yyyy 年', { locale: zhCN })}</span></div><div className="calendar-heading-actions">{view !== 'today' && <div className="work-total"><Clock3 size={15} />当前视图 {durationLabel(totalMinutes)}</div>}<button className={`secondary-button batch-toggle${batchMode ? ' is-active' : ''}`} type="button" onClick={toggleBatchMode}><ListChecks size={15} />{batchMode ? '退出批量' : '批量管理'}</button></div></div>{batchMode && <div className="batch-toolbar"><strong>已选择 {batchSelection.size} 项</strong><div className="batch-actions"><select aria-label="批量修改状态" defaultValue="" onChange={(event) => { if (event.target.value) batchSetStatus(event.target.value as TaskStatus); event.currentTarget.value = '' }}><option value="" disabled>修改状态</option><option value="todo">待办</option><option value="in-progress">进行中</option><option value="completed">已完成</option></select><select aria-label="批量修改颜色" defaultValue="" onChange={(event) => { if (event.target.value) batchSetColor(event.target.value as TaskColor); event.currentTarget.value = '' }}><option value="" disabled>修改颜色</option>{COLORS.map((color) => <option value={color.value} key={color.value}>{color.label}</option>)}</select><select aria-label="批量设置开始提醒" defaultValue="" onChange={(event) => { if (event.target.value) batchSetStartReminder(event.target.value); event.currentTarget.value = '' }}><option value="" disabled>开始提醒</option>{REMINDER_OPTIONS.map((option) => <option key={String(option.value)} value={option.value === null ? 'none' : option.value}>{option.label}</option>)}</select><select aria-label="批量设置结束提醒" defaultValue="" onChange={(event) => { if (event.target.value) batchSetEndReminder(event.target.value); event.currentTarget.value = '' }}><option value="" disabled>结束提醒</option><option value="on">开启</option><option value="off">关闭</option></select><input aria-label="批量添加标签" placeholder="添加标签" value={batchTags} onChange={(event) => setBatchTags(event.target.value)} /><button className="secondary-button" type="button" disabled={batchSelection.size === 0 || parseTags(batchTags).length === 0} onClick={batchSetTags}>添加标签</button><button className="danger-button batch-delete" type="button" disabled={batchSelection.size === 0} onClick={batchDelete}><Trash2 size={15} />删除</button></div></div>}{calendarBody()}</main>
      </div>
      {editingTaskId && <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditingTaskId(null)}><section className="edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-heading"><h2 id="edit-title">编辑工作方块</h2><button className="icon-button" type="button" aria-label="关闭" title="关闭" onClick={() => setEditingTaskId(null)}><X size={18} /></button></div><form onSubmit={saveEdit}><label htmlFor="edit-task-title">工作内容</label><input id="edit-task-title" autoFocus value={editingDraft.title} onChange={(event) => setEditingDraft((current) => ({ ...current, title: event.target.value }))} maxLength={60} /><TimeFields prefix="edit" start={editingStart} duration={editingDuration} end={editingEnd} mode={editingTimeMode} onStart={setEditingStart} onDuration={setEditingDuration} onEnd={setEditingEnd} onMode={setEditingTimeMode} />{tasks.find((task) => task.id === editingTaskId)?.planAllocation && <button type="button" className="plan-link" onClick={() => { const planId = tasks.find((task) => task.id === editingTaskId)?.planAllocation?.planId; setEditingTaskId(null); if (planId) setEditingPlanId(planId) }}>查看所属长期计划</button>}<label htmlFor="edit-reminder"><Bell size={13} />开始提醒</label><select id="edit-reminder" value={editingReminder === null ? 'none' : String(editingReminder)} disabled={!editingStart} onChange={(event) => { const value = event.target.value === 'none' ? null : Number(event.target.value); setEditingReminder(value); if (value !== null) setEditingEndReminder(true) }}>{REMINDER_OPTIONS.map((option) => <option key={String(option.value)} value={option.value === null ? 'none' : option.value}>{option.label}</option>)}</select><label className="end-reminder-toggle"><input type="checkbox" checked={editingEndReminder} disabled={!editingStart} onChange={(event) => setEditingEndReminder(event.target.checked)} /><span><strong>结束时提醒</strong><small>达到预计结束时间时再次通知</small></span></label>{(editingReminder !== null || editingEndReminder) && <small className="field-hint">{editingStart ? `${editingReminder !== null ? `${reminderLabel(editingReminder)}提醒` : '不在开始前提醒'}${editingEndReminder ? '，并在结束时提醒' : ''}` : '先设置开始时间才能启用提醒'}</small>}<label htmlFor="edit-tags">标签（逗号分隔）</label><input id="edit-tags" value={editingTags} onChange={(event) => setEditingTags(event.target.value)} placeholder="例如：客户，重要" maxLength={200} /><span className="dialog-label">状态</span><div className="status-switcher" role="group" aria-label="任务状态">{(['todo','in-progress','completed'] as TaskStatus[]).map((status) => <button key={status} type="button" className={editingStatus === status ? 'is-active' : ''} onClick={() => setEditingStatus(status)}>{status === 'todo' ? <Circle size={14} /> : status === 'in-progress' ? <Play size={14} /> : <CheckCircle2 size={14} />}{STATUS_LABELS[status]}</button>)}</div><span className="dialog-label">颜色</span><div className="color-picker" role="group" aria-label="方块颜色">{COLORS.map((color) => <button key={color.value} className={`color-swatch color-${color.value}`} type="button" aria-label={color.label} aria-pressed={editingDraft.color === color.value} onClick={() => setEditingDraft((current) => ({ ...current, color: color.value }))}>{editingDraft.color === color.value && <Check size={12} />}</button>)}</div><div className="dialog-actions">{tasks.find((task) => task.id === editingTaskId)?.start && <button className="secondary-button" type="button" onClick={() => { unscheduleTask(editingTaskId); setEditingTaskId(null) }}><RotateCcw size={16} />移回待安排</button>}<button className="danger-button" type="button" aria-label="删除工作方块" title="删除" onClick={deleteEditingTask}><Trash2 size={17} /></button><button className="primary-button" type="submit">保存</button></div></form></section></div>}
      {trashOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setTrashOpen(false)}><section className="edit-dialog trash-dialog" role="dialog" aria-modal="true" aria-labelledby="trash-title" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-heading"><div><h2 id="trash-title">回收站</h2><p>{trashedTasks.length} 项工作</p></div><button className="icon-button" type="button" aria-label="关闭回收站" title="关闭" onClick={() => setTrashOpen(false)}><X size={18} /></button></div>{trashedTasks.length === 0 ? <div className="trash-empty"><Trash2 size={22} /><span>回收站为空</span></div> : <><div className="trash-list">{trashedTasks.map((task) => <div className="trash-item" key={task.id}><div><strong>{task.title}</strong><small>{format(new Date(task.deletedAt!), 'yyyy-MM-dd HH:mm')} 删除</small></div><button className="secondary-button" type="button" onClick={() => restoreTask(task.id)}><RotateCcw size={14} />恢复</button><button className="danger-button" type="button" aria-label={`永久删除 ${task.title}`} title="永久删除" onClick={() => permanentlyDeleteTask(task.id)}><Trash2 size={15} /></button></div>)}</div><div className="dialog-actions trash-actions"><button className="danger-primary-button" type="button" onClick={emptyTrash}><Trash2 size={15} />清空回收站</button></div></>}</section></div>}
      {pendingSchedule && <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingSchedule(null)}><section className="edit-dialog reschedule-dialog" role="dialog" aria-modal="true" aria-labelledby="reschedule-title" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-heading"><h2 id="reschedule-title">重新安排已完成任务</h2><button className="icon-button" type="button" aria-label="关闭" onClick={() => setPendingSchedule(null)}><X size={18} /></button></div><p>这个任务已经完成。移动到新时间后，是否将它重新打开为待办？</p><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setPendingSchedule(null)}>取消</button><button className="secondary-button" type="button" onClick={() => { scheduleTask(pendingSchedule.taskId, pendingSchedule.slot, false); setPendingSchedule(null) }}>保持完成</button><button className="primary-button" type="button" onClick={() => { scheduleTask(pendingSchedule.taskId, pendingSchedule.slot, true); setPendingSchedule(null) }}>重新打开并移动</button></div></section></div>}
      {toast && <div className="toast" role="status"><span>{toast}</span>{undoEntry && <button type="button" onClick={undoLastChange}>撤销</button>}</div>}
    </div>
    <DragOverlay dropAnimation={null}>{activeTask && <article className={`task-card drag-overlay color-${activeTask.color}`} style={{ '--drag-preview-offset-y': `${dragPreviewOffsetY}px` } as React.CSSProperties}><GripVertical className="drag-handle" size={15} /><div className="task-copy"><strong>{activeTask.title}</strong><span><Clock3 size={13} />{durationLabel(activeTask.duration)}</span></div></article>}</DragOverlay>
  </DndContext>
}

export default App
