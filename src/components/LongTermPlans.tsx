import { useCallback, useState } from 'react'
import { useDraggable, useDroppable, useDndContext } from '@dnd-kit/core'
import { CalendarPlus, Check, ChevronDown, Flag, GripVertical, Pencil, Plus, Scissors, Trash2, X } from 'lucide-react'
import { createPlan, deadlineLabel, mergePlanParts, orderedPlans, planChildren, planStats, removePlan, reorderPlans, splitPlan, updatePlanDefinition } from '../plans'
import { parseDurationInput } from '../scheduling'
import { saveTasks } from '../storage'
import SelectionCheckbox from './SelectionCheckbox'
import type { LongTermPlan, Task, TaskColor } from '../types'

const colors: TaskColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'purple']
function localTime(value: string | null) { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
type Commit = (label: string, message: string, update: (tasks: Task[]) => Task[]) => boolean | void

function SortablePlanCard({ plan, index, selected, onMove, children }: { plan: Task; index: number; selected: boolean; onMove: (direction: number) => void; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: `plan:${plan.id}`, data: { type: 'plan-order', planId: plan.id, index } })
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `plan-order:${plan.id}`, data: { type: 'plan-order', planId: plan.id } })
  const setCardRef = useCallback((node: HTMLElement | null) => { setNodeRef(node); setDropRef(node) }, [setNodeRef, setDropRef])
  const { active } = useDndContext()
  return <article ref={setCardRef} className={`plan-card color-${plan.color}${plan.status === 'completed' ? ' is-completed' : ''}${selected ? ' is-batch-selected' : ''}${isDragging ? ' is-reordering' : ''}${isOver && active?.id !== `plan:${plan.id}` ? ' is-sort-target' : ''}`} data-plan-id={plan.id} data-insert-after={active?.data.current?.index < index}>
    {children(<button ref={setActivatorNodeRef} type="button" className="plan-sort-handle" {...attributes} {...listeners} aria-label={`拖动排序 ${plan.title}`} title="按住上下拖动排序，也可聚焦后按方向键" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); onMove(event.key === 'ArrowUp' ? -1 : 1) } }}><GripVertical size={16} aria-hidden="true" /></button>)}
  </article>
}

export function DeadlineStrip({ tasks, now, onOpen }: { tasks: Task[]; now: Date; onOpen: (plan: Task) => void }) {
  const deadlines = tasks.filter((task) => task.planDefinition?.deadline && task.status !== 'completed' && !(task.planDefinition.type === 'countable' && planStats(tasks, task).completed === task.planDefinition.totalUnits)).sort((a, b) => Date.parse(a.planDefinition!.deadline!) - Date.parse(b.planDefinition!.deadline!))
  if (!deadlines.length) return null
  return <section className="deadline-strip" aria-label="计划截止日期"><span className="deadline-heading"><Flag size={15} />DDL</span><div className="deadline-items">{deadlines.map((plan) => <button type="button" key={plan.id} className={`deadline-chip color-${plan.color}${Date.parse(plan.planDefinition!.deadline!) < now.getTime() ? ' is-overdue' : ''}`} onClick={() => onOpen(plan)}><strong>{plan.title}</strong><span>{deadlineLabel(plan.planDefinition!.deadline!, now)}</span><small>{localTime(plan.planDefinition!.deadline).replace('T', ' ')}</small></button>)}</div></section>
}

export default function LongTermPlans({ tasks, commit: commitTasks, notify, renderTask, editingPlan, onEditPlan, now, batchSelection, onToggleBatch, onQuickArrange }: {
  tasks: Task[]; commit: Commit; notify: (message: string) => void; renderTask: (task: Task) => React.ReactNode
  editingPlan: Task | null; onEditPlan: (task: Task | null) => void; now: Date
  batchSelection: ReadonlySet<string>; onToggleBatch: (id: string) => void
  onQuickArrange: (plan: Task) => void
}) {
  const [sectionOpen, setSectionOpen] = useState(true)
  const [creating, setCreating] = useState(false)
  const [creatingCollapsed, setCreatingCollapsed] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [splitOpen, setSplitOpen] = useState<string | null>(null)
  const [group, setGroup] = useState('1')
  const plans = orderedPlans(tasks)
  function commit(label: string, message: string, update: (tasks: Task[]) => Task[]) {
    try {
      const result = commitTasks(label, message, (current) => {
        const next = update(current)
        try { saveTasks(next) } catch { throw new Error('浏览器存储空间不足，操作未保存，原有日程保留') }
        return next
      })
      return result !== false
    } catch (error) { notify((error as Error).message); return false }
  }
  function applySplit(plan: Task) {
    try {
      if (!commit('拆分计划', '已生成待安排日程，可直接拖入日历', (current) => splitPlan(current, plan.id, Number(group)))) return
      setExpanded(plan.id); setSplitOpen(null)
    } catch (error) { notify((error as Error).message) }
  }
  function merge(plan: Task, selected: Set<string>) {
    try { if (!commit('合并计划日程', '已合并为一个待安排日程', (current) => mergePlanParts(current, plan.id, selected))) return }
    catch (error) { notify((error as Error).message) }
  }
  return <section className="long-term-plans" aria-label="长期计划">
    <div className="sidebar-section-heading"><h2><button type="button" className="sidebar-section-toggle" aria-expanded={sectionOpen} aria-controls="long-term-content" onClick={() => setSectionOpen(!sectionOpen)}><ChevronDown size={14} />长期计划<span>{plans.length}</span></button></h2><button type="button" className="icon-button section-add" aria-label="新建计划" title="新建计划" onClick={() => { setSectionOpen(true); setCreating(true) }}><Plus size={16} /></button></div>
    <div id="long-term-content" className="sidebar-section-body" hidden={!sectionOpen || creatingCollapsed}>
    {!plans.length && <p className="plan-help">网课可一键拆成多节再拖入日历；作业可固定显示截止日期。</p>}
    {plans.length > 1 && <p className="plan-help">按住标题旁的手柄上下排序；拆分方块仍可直接拖入日历。</p>}
    <div className="plan-list">{plans.map((plan, index) => {
      const definition = plan.planDefinition!
      const stats = planStats(tasks, plan)
      const parts = planChildren(tasks, plan.id).filter((task) => !task.deletedAt && !task.start).sort((a, b) => (a.planAllocation!.units[0] ?? 0) - (b.planAllocation!.units[0] ?? 0))
      const isExpanded = expanded === plan.id
      const selected = new Set(parts.filter((task) => task.status === 'todo' && batchSelection.has(task.id)).map((task) => task.id))
      return <SortablePlanCard key={plan.id} plan={plan} index={index} selected={batchSelection.has(plan.id)} onMove={(direction) => {
        const target = plans[plans.findIndex((item) => item.id === plan.id) + direction]
        if (target) commit('计划排序', '计划顺序已保存', (current) => reorderPlans(current, plan.id, target.id))
      }}>{(handle) => <>
        <div className="plan-card-heading">{handle}<SelectionCheckbox selected={batchSelection.has(plan.id)} label={`选择长期计划 ${plan.title}`} onToggle={() => onToggleBatch(plan.id)} /><strong>{plan.title}</strong><button type="button" className="icon-button" aria-label={`编辑计划 ${plan.title}`} onClick={() => onEditPlan(plan)}><Pencil size={14} /></button></div>
        {definition.type === 'countable' ? <><div className="plan-progress"><span style={{ width: `${stats.completed / stats.total * 100}%` }} /></div><p className="plan-counts">已安排 {stats.scheduled}/{stats.total} {definition.unitLabel} · 已完成 {stats.completed}/{stats.total}</p><p className="plan-counts">待安排 {stats.waiting} {definition.unitLabel} · 未拆分 {stats.ungenerated} {definition.unitLabel}</p></> : <p className="plan-counts">{plan.status === 'completed' ? '已完成' : '按截止日期推进'}</p>}
        {definition.deadline && <p className="plan-deadline"><Flag size={12} />{localTime(definition.deadline).replace('T', ' ')} · {plan.status === 'completed' ? '已完成' : deadlineLabel(definition.deadline, now)}</p>}
        {definition.type === 'countable' && <><button type="button" className="plan-split-button" disabled={stats.ungenerated === 0 || plan.status === 'completed'} onClick={() => { setSplitOpen(splitOpen === plan.id ? null : plan.id); setGroup('1') }}><Scissors size={14} />{stats.ungenerated ? '拆分为可安排日程' : '已全部拆分'}</button>{splitOpen === plan.id && <div className="plan-split-panel"><label htmlFor={`group-${plan.id}`}>每个日程包含多少{definition.unitLabel}</label><input id={`group-${plan.id}`} type="number" min="1" max={stats.ungenerated} step="1" value={group} onChange={(event) => setGroup(event.target.value)} /><small>只拆分未生成的部分，不改变已安排日程。</small><button type="button" className="primary-button" onClick={() => applySplit(plan)}>生成待安排日程</button></div>}</>}
        {definition.type === 'deadline' && <button type="button" className="plan-split-button" disabled={plan.status === 'completed'} onClick={() => { commit('添加计划工作时段', '已创建待安排工作时段，可编辑名称并拖入日历', (current) => { const source = current.find((item) => item.id === plan.id && item.planDefinition); if (!source) throw new Error('计划已不存在'); const { planDefinition: _definition, ...block } = createPlan(`${source.title.slice(0, 40)} · 工作时段 ${planChildren(current, plan.id).length + 1}`, source.color, source.duration, source.planDefinition!); return [...current, { ...block, planAllocation: { planId: source.id, units: [] } }] }); setExpanded(plan.id) }}><Plus size={14} />添加工作时段</button>}
        {parts.some((task) => task.status !== 'completed') && plan.status !== 'completed' && <button type="button" className="plan-quick-arrange" data-quick-plan-id={plan.id} aria-label={`快捷安排 ${plan.title}`} onClick={() => onQuickArrange(plan)}><CalendarPlus size={14} />快捷安排</button>}
        {parts.length > 0 && <button type="button" className="plan-expand" aria-expanded={isExpanded} aria-controls={`parts-${plan.id}`} onClick={() => { setExpanded(current => current === plan.id ? null : plan.id) }}><ChevronDown size={14} aria-hidden="true" />查看待安排方块（{parts.length}）</button>}
        <div id={`parts-${plan.id}`} className={`plan-disclosure${isExpanded && parts.length ? ' is-expanded' : ''}`} inert={!isExpanded || !parts.length} aria-hidden={!isExpanded || !parts.length}>
          <div className="plan-disclosure-clip"><div className="plan-parts">{parts.length > 0 && <><p className="plan-help">直接拖入日历；勾选后可一键删除，同一计划的待办方块也可合并。</p>{parts.map((task) => <div className="plan-part" key={task.id}>{renderTask(task)}</div>)}{definition.type === 'countable' && <button type="button" className="secondary-button" disabled={selected.size < 2} onClick={() => merge(plan, selected)}>合并选中的 {selected.size} 个方块</button>}</>}</div></div>
        </div>
      </>}</SortablePlanCard>
    })}</div>
    </div>
    {creating && !creatingCollapsed && !editingPlan && <PlanDialog key="new" plan={null} tasks={tasks} commit={commit} notify={notify} onClose={() => { setCreating(false); setCreatingCollapsed(false) }} />}
    {(editingPlan || (creating && creatingCollapsed)) && <PlanDialog key={editingPlan?.id ?? 'new'} plan={editingPlan} tasks={tasks} commit={commit} notify={notify} onClose={() => { if (!editingPlan) { setCreating(false); setCreatingCollapsed(false) }; onEditPlan(null) }} />}
  </section>
}

function PlanDialog({ plan, tasks, commit, notify, onClose }: { plan: Task | null; tasks: Task[]; commit: Commit; notify: (message: string) => void; onClose: () => void }) {
  const [openedVersion] = useState(plan ? JSON.stringify(plan) : null)
  const [title, setTitle] = useState(plan?.title ?? '')
  const [type, setType] = useState<LongTermPlan['type']>(plan?.planDefinition?.type ?? 'countable')
  const [total, setTotal] = useState(String(plan?.planDefinition?.totalUnits || 10))
  const [unit, setUnit] = useState(plan?.planDefinition?.unitLabel ?? '节')
  const [duration, setDuration] = useState(String(plan?.duration ?? 60))
  const [deadline, setDeadline] = useState(localTime(plan?.planDefinition?.deadline ?? null))
  const [notes, setNotes] = useState(plan?.planDefinition?.notes ?? '')
  const [color, setColor] = useState<TaskColor>(plan?.color ?? 'blue')
  const [reminder, setReminder] = useState<number | null>(plan?.planDefinition?.reminderMinutes ?? null)
  const [completed, setCompleted] = useState(plan?.status === 'completed')
  function save(event: React.FormEvent) {
    event.preventDefault()
    const parsedDuration = parseDurationInput(duration)
    const amount = type === 'countable' ? Number(total) : 0
    if (!title.trim() || !unit.trim() || !parsedDuration || (type === 'countable' && (!Number.isInteger(amount) || amount < 1 || amount > 500))) { notify('请填写名称、单位、有效总量和时长'); return }
    const deadlineDate = deadline ? new Date(deadline) : null
    if (deadlineDate && !Number.isFinite(deadlineDate.getTime())) { notify('请填写有效的截止日期与时间'); return }
    const definition: LongTermPlan = { type, totalUnits: amount, unitLabel: unit.trim(), deadline: deadlineDate?.toISOString() ?? null, notes, reminderMinutes: deadlineDate ? reminder : null }
    try {
      const saved = commit(plan ? '编辑计划' : '创建计划', plan ? '计划已保存，现有日程不变' : '计划已创建，点击“拆分为可安排日程”生成方块', (current) => {
        const existing = plan ? current.find((task) => task.id === plan.id) : null
        if (plan && !existing) throw new Error('计划已被另一台设备删除，请重新打开')
        if (existing && JSON.stringify(existing) !== openedVersion) throw new Error('计划已变化，请重新打开核对后保存；当前数据未覆盖')
        const sortOrder = existing ? existing.planDefinition?.sortOrder : Math.max(-1, ...orderedPlans(current).map((task, index) => task.planDefinition!.sortOrder ?? index)) + 1
        const nextDefinition = { ...definition, ...(sortOrder !== undefined ? { sortOrder } : {}) }
        const updated = { ...(existing ?? createPlan(title, color, parsedDuration, nextDefinition)), title: title.trim(), color, duration: parsedDuration, planDefinition: nextDefinition, status: completed ? 'completed' as const : 'todo' as const, completedAt: completed ? existing?.completedAt ?? new Date().toISOString() : null, remindedAt: existing?.planDefinition?.deadline === definition.deadline && existing?.planDefinition?.reminderMinutes === reminder && !(!completed && existing?.status === 'completed') ? existing?.remindedAt ?? null : null }
        return existing ? updatePlanDefinition(current, existing.id, nextDefinition).map((task) => task.id === existing.id ? updated : task) : [...current, updated]
      })
      if (saved === false) return
      onClose()
    } catch (error) { notify((error as Error).message) }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="edit-dialog plan-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-title" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-heading"><h2 id="plan-title">{plan ? '编辑长期计划' : '新建长期计划'}</h2><button className="icon-button" type="button" aria-label="关闭计划" onClick={onClose}><X size={18} /></button></div><form onSubmit={save}>
    <label htmlFor="plan-name">计划名称</label><input id="plan-name" autoFocus maxLength={60} required value={title} onChange={(event) => setTitle(event.target.value)} />
    <label className="end-reminder-toggle"><input id="plan-splittable" type="checkbox" checked={type === 'countable'} disabled={!!plan && planChildren(tasks, plan.id).some((task) => task.planAllocation!.units.length > 0)} onChange={(event) => { setType(event.target.checked ? 'countable' : 'deadline'); if (event.target.checked && Number(total) < 1) setTotal(String(Math.max(10, plan ? planChildren(tasks, plan.id).length : 0))) }} /><span>启用数量拆分</span></label>
    <p className="plan-help">数量拆分和截止时间可同时设置，例如 10 节网课在月底前完成。没有明确数量时，也可以只添加工作时段。</p>
    {plan && plan.planDefinition?.type === 'deadline' && type === 'countable' && planChildren(tasks, plan.id).length > 0 && <p className="plan-help">现有每个工作时段会计为 1 个单位，名称、时间和完成状态保留。</p>}
    {plan && planChildren(tasks, plan.id).some((task) => task.planAllocation!.units.length > 0) && <small className="field-hint">已有编号方块时保留数量拆分，截止时间可随时修改。</small>}
    {type === 'countable' && <><div className="plan-field-row"><div><label htmlFor="plan-total">总量</label><input id="plan-total" type="number" min="1" max="500" step="1" required value={total} onChange={(event) => setTotal(event.target.value)} /></div><div><label htmlFor="plan-unit">单位</label><input id="plan-unit" maxLength={8} required value={unit} onChange={(event) => setUnit(event.target.value)} /></div></div><label htmlFor="plan-duration">每单位预计时长（分钟）</label><input id="plan-duration" type="number" min="1" max="720" step="1" required value={duration} onChange={(event) => setDuration(event.target.value)} /><small className="field-hint">作为拆分默认时长；之后可逐个调整。修改默认值不影响已生成日程。</small></>}
    <label htmlFor="plan-deadline">截止日期与时间（可选）</label><input id="plan-deadline" type="datetime-local" step="60" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
    <label htmlFor="plan-reminder">截止提醒</label><select id="plan-reminder" disabled={!deadline} value={reminder === null ? 'none' : reminder} onChange={(event) => setReminder(event.target.value === 'none' ? null : Number(event.target.value))}><option value="none">不提醒</option><option value="10080">提前 7 天</option><option value="1440">提前 1 天</option><option value="60">提前 1 小时</option><option value="0">截止时</option></select><small className="field-hint">仅在网页/PWA 运行时检查，关闭应用后不能保证通知。</small>
    <label htmlFor="plan-notes">备注</label><textarea id="plan-notes" maxLength={1000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
    <div className="color-picker" role="group" aria-label="计划颜色">{colors.map((value) => <button key={value} type="button" className={`color-swatch color-${value}`} aria-label={`计划颜色 ${value}`} aria-pressed={color === value} onClick={() => setColor(value)}>{color === value && <Check size={12} />}</button>)}</div>
    {plan && type === 'deadline' && <label className="end-reminder-toggle"><input type="checkbox" checked={completed} onChange={(event) => setCompleted(event.target.checked)} /><span>计划已完成（完成后不再显示 DDL 提醒）</span></label>}
    <div className="dialog-actions">{plan && <button type="button" className="danger-button" onClick={() => { const live = tasks.find((task) => task.id === plan.id); if (live && window.confirm('删除长期计划？拆分日程会保留并变成普通日程，不会删除你的安排。')) { commit('删除计划', '计划已删除，原日程全部保留', (current) => removePlan(current, plan.id)); onClose() } }}><Trash2 size={15} />删除计划</button>}<button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button">保存计划</button></div>
  </form></section></div>
}
