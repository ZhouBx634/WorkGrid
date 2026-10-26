import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { GripVertical, Pencil, X } from 'lucide-react'
import { pendingPlanGroups } from '../plans'
import type { Task } from '../types'

function LessonShortcut({ task, selected, onSelect, onEdit }: { task: Task; selected: boolean; onSelect: () => void; onEdit: () => void }) {
  // The same lesson also appears in its plan. Use a separate drag registration.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: `quick:${task.id}`, data: { taskId: task.id, type: 'lesson-shortcut' } })
  return <div ref={setNodeRef} className={`lesson-shortcut color-${task.color}${selected ? ' is-selected' : ''}${isDragging ? ' is-dragging' : ''}`} data-task-id={task.id}>
    <button ref={setActivatorNodeRef} type="button" className="lesson-drag" {...attributes} {...listeners} aria-label={`拖动安排 ${task.title}`} title="按住点阵拖入日历" onClick={() => { if (!isDragging) onSelect() }}><GripVertical size={16} aria-hidden="true" /></button>
    <button type="button" className="lesson-select" aria-label={`选择安排 ${task.title}`} aria-pressed={selected} onClick={onSelect}><strong>{task.title}</strong><small>{task.duration} 分钟</small></button>
    <button type="button" className="icon-button" aria-label={`快捷编辑 ${task.title}`} onClick={onEdit}><Pencil size={14} /></button>
  </div>
}

export default function PendingPlanTasks({ tasks, plan, selectedId, dragging, onSelect, onEdit, onClose }: { tasks: Task[]; plan: Task; selectedId: string | null; dragging: boolean; onSelect: (task: Task) => void; onEdit: (task: Task) => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const windowRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const [draggingWindow, setDraggingWindow] = useState(false)
  const [position, setPosition] = useState(() => ({ x: 10, y: typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches ? 118 : 72 }))
  const parts = pendingPlanGroups(tasks).find((group) => group.plan.id === plan.id)?.parts ?? []
  function clampPosition(x: number, y: number) {
    const width = windowRef.current?.offsetWidth ?? 250
    const height = windowRef.current?.offsetHeight ?? 300
    return { x: Math.max(8, Math.min(x, window.innerWidth - width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - Math.min(height, window.innerHeight - 8) - 8)) }
  }
  function startWindowDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    const rect = windowRef.current?.getBoundingClientRect()
    if (!rect) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraggingWindow(true)
  }
  function moveWindow(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPosition(clampPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY))
  }
  function endWindowDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDraggingWindow(false)
  }
  useEffect(() => {
    function keepOnScreen() {
      setPosition((current) => {
        const next = clampPosition(current.x, current.y)
        return next.x === current.x && next.y === current.y ? current : next
      })
    }
    const observer = new ResizeObserver(keepOnScreen)
    if (windowRef.current) observer.observe(windowRef.current)
    window.addEventListener('resize', keepOnScreen)
    return () => { observer.disconnect(); window.removeEventListener('resize', keepOnScreen) }
  }, [])
  useEffect(() => {
    const previousFocus = document.querySelector<HTMLElement>(`[data-quick-plan-id="${CSS.escape(plan.id)}"]`)
    closeRef.current?.focus({ preventScroll: true })
    return () => { requestAnimationFrame(() => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) }) }
  }, [])
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !dragging && !document.querySelector('[aria-modal="true"]')) { event.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [dragging, onClose])
  return <aside ref={windowRef} className={`plan-shortcuts${dragging ? ' is-dragging-lesson' : ''}`} style={{ left: position.x, top: position.y }} aria-label="快捷安排">
    <div className={`shortcuts-heading${draggingWindow ? ' is-dragging-window' : ''}`} onPointerDown={startWindowDrag} onPointerMove={moveWindow} onPointerUp={endWindowDrag} onPointerCancel={endWindowDrag} onLostPointerCapture={() => { dragRef.current = null; setDraggingWindow(false) }}><span className="shortcuts-drag-handle" aria-hidden="true"><GripVertical size={15} /></span><strong title="拖动标题栏移动窗口，聚焦后也可按方向键" tabIndex={0} role="button" aria-label="移动快捷安排窗口" onKeyDown={(event) => {
      const offset = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key]
      if (offset) { event.preventDefault(); event.stopPropagation(); setPosition((current) => clampPosition(current.x + offset[0], current.y + offset[1])) }
    }}>快捷安排</strong><button ref={closeRef} type="button" className="icon-button" aria-label="关闭快捷安排" onClick={onClose}><X size={17} /></button></div>
    <div className="shortcut-content" inert={dragging}>
      <p className="shortcut-plan-name">{plan.title}<span aria-live="polite">{parts.length} 个待安排</span></p>
      <p className="plan-help">拖动标题栏移动窗口；按住课程点阵拖入日历，或点选后点击时间格。</p>
      <div className="shortcut-groups"><div className="shortcut-parts">{parts.map((task) => <LessonShortcut key={task.id} task={task} selected={selectedId === task.id} onSelect={() => { onSelect(task); if (window.matchMedia('(max-width: 900px)').matches) onClose() }} onEdit={() => onEdit(task)} />)}</div>{!parts.length && <p className="shortcut-empty">这个计划的日程已全部安排，或已完成。</p>}</div>
    </div>
  </aside>
}
