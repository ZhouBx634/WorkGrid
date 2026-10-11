import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CalendarDays, FileUp, RotateCcw, X } from 'lucide-react'
import { classifyCourse, courseOverlapCount, MAX_ICS_BYTES, parseCourseCalendar, type CourseCalendar, type CourseOccurrence } from '../courseImport'
import { courseInRange, courseMatchesSearch, createSampleCourseCalendar, type CourseImportRange } from '../courseImportPreview'
import type { Task, TaskColor } from '../types'

interface Props {
  tasks: Task[]
  canUndo: boolean
  onApply: (courses: CourseOccurrence[], updateKeys: Set<string>, reviewedTasks: string) => boolean
  onUndo: () => void
  onClose: () => void
}
const COLOR_OPTIONS: Array<[TaskColor, string]> = [['red', '红'], ['orange', '橙'], ['yellow', '黄'], ['green', '绿'], ['blue', '蓝'], ['indigo', '靛'], ['purple', '紫']]
const ACTION_LABELS = { new: '新增', unchanged: '已导入 · 保留本机', update: '课表有变化', 'local-edit': '已手动修改 · 默认保留', deleted: '已删除 · 跳过' }
function time(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
}

export default function CourseImport({ tasks, canUndo, onApply, onUndo, onClose }: Props) {
  const [calendar, setCalendar] = useState<CourseCalendar | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [range, setRange] = useState<CourseImportRange>('future')
  const [query, setQuery] = useState('')
  const [selectedLessons, setSelectedLessons] = useState(new Set<string>())
  const [pasteOpen, setPasteOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(true)
  const [pastedText, setPastedText] = useState('')
  const [isSample, setIsSample] = useState(false)
  const [draggingFile, setDraggingFile] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [selectedCourses, setSelectedCourses] = useState(new Set<string>())
  const [colors, setColors] = useState<Record<string, TaskColor>>({})
  const [updates, setUpdates] = useState(new Set<string>())
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
  // Any external/local changes invalidate previously checked update approvals.
  useEffect(() => { setUpdates(new Set()) }, [tasks])
  useEffect(() => {
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [onClose])

  const courses = useMemo(() => [...new Set(calendar?.events.map((event) => event.course))], [calendar])
  const previewDate = new Date()
  const inRange = (calendar?.events ?? []).filter((event) => courseInRange(event, range, previewDate) && selectedCourses.has(event.course))
  const visible = inRange.filter((event) => courseMatchesSearch(event, query))
  const additions = inRange.filter((event) => selectedLessons.has(event.key) && classifyCourse(tasks, event) === 'new')
  const approved = inRange.filter((event) => updates.has(event.key) && ['update', 'local-edit'].includes(classifyCourse(tasks, event)))
  const overlaps = additions.concat(approved).filter((event) => courseOverlapCount(tasks, event) > 0).length

  async function readContents(name: string, read: () => Promise<string>, sample = false, keepSourceOpen = false) {
    const ticket = ++request.current
    setCalendar(null); setError(''); setUpdates(new Set()); setSelectedLessons(new Set())
    setFileName(name); setIsSample(sample); setQuery(''); setRange('future')
    setReading(true)
    try {
      const result = await parseCourseCalendar(await read())
      if (ticket !== request.current) return
      setCalendar(result)
      setSelectedCourses(new Set(result.events.map((event) => event.course)))
      setSelectedLessons(new Set(result.events.map((event) => event.key)))
      setColors(Object.fromEntries(result.events.map((event) => [event.course, event.color])))
      setSourceOpen(keepSourceOpen)
    } catch (caught) {
      if (ticket === request.current) setError(caught instanceof Error ? caught.message : '读取失败，请重新选择课表')
    } finally { if (ticket === request.current) setReading(false) }
  }
  function readFile(file: File | undefined) {
    if (!file) return
    setPasteOpen(false)
    void readContents(file.name, async () => {
      if (!file.name.toLowerCase().endsWith('.ics')) throw new Error('请选择教务系统下载的 .ics 文件')
      if (file.size > MAX_ICS_BYTES) throw new Error('课表超过 2MB，请导出较小的课表文件')
      return file.text()
    })
  }
  function selectVisible(selected: boolean) {
    const newKeys = visible.filter((event) => classifyCourse(tasks, event) === 'new').map((event) => event.key)
    setSelectedLessons((previous) => {
      const next = new Set(previous)
      for (const key of newKeys) { if (selected) next.add(key); else next.delete(key) }
      return next
    })
    // Bulk selection never approves overwriting an existing or manually edited course.
    if (!selected) setUpdates((previous) => new Set([...previous].filter((key) => !visible.some((event) => event.key === key))))
  }
  function apply() {
    const mapped = additions.concat(approved).map((event) => ({ ...event, color: colors[event.course] ?? event.color }))
    if (onApply(mapped, updates, JSON.stringify(tasks))) onClose()
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="data-dialog course-import-dialog" role="dialog" aria-modal="true" aria-labelledby="course-import-title" onMouseDown={(event) => event.stopPropagation()}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDraggingFile(true) } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFile(false) }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault(); setDraggingFile(false)
        if (!event.dataTransfer.files.length) return
        if (event.dataTransfer.files.length > 1) {
          request.current++; setCalendar(null); setUpdates(new Set()); setSelectedLessons(new Set()); setReading(false)
          setError('每次请选择一个 ICS 文件，分别导入不会影响原有日程'); return
        }
        readFile(event.dataTransfer.files[0])
      }}>
      <div className="dialog-heading"><div className="dialog-title"><span className="dialog-icon"><CalendarDays size={18} /></span><div><h2 id="course-import-title">导入课表</h2><p>选择教务系统下载的 ICS 文件</p></div></div><button className="icon-button" aria-label="关闭课表导入" onClick={onClose}><X size={18} /></button></div>
      <div className="course-import-content">
      <p className="privacy-note">文件在本机解析。原有日程保持不变，课表更新需确认。已登录时，导入的课程会随日程同步到你的账户。</p>
      {calendar && !sourceOpen && <div className="course-source-summary"><FileUp size={16} /><strong>{fileName}</strong><button className="text-button" type="button" onClick={() => setSourceOpen(true)}>更换来源</button></div>}
      <div hidden={Boolean(calendar && !sourceOpen)}>
      <div className={`file-picker course-file-picker${draggingFile ? ' is-dragging' : ''}`}><FileUp size={22} /><div><strong>{fileName || '选择或拖入课表文件'}</strong><span>教务系统 → 订阅到日历 → 浏览器打开链接下载文件</span><span>支持 .ics 文件，最大 2MB；也可拖到此窗口</span></div><button className="secondary-button" type="button" disabled={reading} onClick={() => fileInput.current?.click()}>选择文件</button><input ref={fileInput} id="course-file" className="sr-only" type="file" accept=".ics,text/calendar" disabled={reading} onChange={(event) => { readFile(event.target.files?.[0]); event.target.value = '' }} /></div>
      <div className="course-input-actions"><button className="text-button" type="button" aria-expanded={pasteOpen} onClick={() => setPasteOpen(!pasteOpen)}>{pasteOpen ? '收起文本输入' : '粘贴 ICS 文本'}</button><button className="text-button" type="button" disabled={reading} onClick={() => { setPasteOpen(false); void readContents('示例课表（非真实课程）', async () => createSampleCourseCalendar(), true) }}>试试示例课表</button></div>
      {pasteOpen && <div className="course-paste"><label htmlFor="course-paste-text">ICS 文本</label><textarea id="course-paste-text" rows={5} maxLength={MAX_ICS_BYTES} placeholder="粘贴 BEGIN:VCALENDAR … END:VCALENDAR 的完整内容，不是订阅链接" value={pastedText} onChange={(event) => { setPastedText(event.target.value); request.current++; setCalendar(null); setUpdates(new Set()); setSelectedLessons(new Set()); setError(''); setReading(false) }} /><button className="secondary-button" type="button" disabled={reading || !pastedText.trim()} onClick={() => { void readContents('粘贴的 ICS 文本', async () => pastedText, false, true) }}>解析文本</button></div>}
      </div>
      {reading && <p role="status">正在解析课表…</p>}
      {error && <div className="error-message" role="alert"><AlertTriangle size={17} />{error}</div>}
      {calendar && <>
        {isSample && <p className="privacy-note course-sample-note" role="status">这是生成的示例课表，不是真实课程。预览不会保存；点击“确认导入课表”才会加入日程，之后可独立撤销。</p>}
        <div className="course-import-controls"><strong>{calendar.name} · {courses.length} 门 · {calendar.events.length} 节</strong><label>导入范围<select aria-label="课表导入范围" value={range} onChange={(event) => { setRange(event.target.value as CourseImportRange); setUpdates(new Set()) }}><option value="future">今天及以后</option><option value="4weeks">未来 4 周（28 天）</option><option value="6weeks">未来 6 周（42 天）</option><option value="14weeks">未来 14 周（98 天）</option><option value="all">文件中的全部日期</option></select></label></div>
        {calendar.warnings.map((warning) => <p className="privacy-note" key={warning}>{warning}</p>)}
        {calendar.recurringThrough && <p className="privacy-note">重复课程展开至 {new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(calendar.recurringThrough))}，按文件中的规则生成。</p>}
        <div className="course-selector" aria-label="选择课程">{courses.map((course) => <div key={course}><label><input type="checkbox" checked={selectedCourses.has(course)} onChange={(event) => setSelectedCourses((previous) => { const next = new Set(previous); event.target.checked ? next.add(course) : next.delete(course); return next })} />{course}</label><select aria-label={`${course}颜色`} value={colors[course]} onChange={(event) => setColors((previous) => ({ ...previous, [course]: event.target.value as TaskColor }))}>{COLOR_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>)}</div>
        <div className="course-preview-toolbar"><label className="course-search">搜索课表<input type="search" aria-label="搜索课表" placeholder="课程、教室、教师或教学班" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="course-selection-actions"><button className="text-button" type="button" disabled={!visible.some((event) => classifyCourse(tasks, event) === 'new')} onClick={() => selectVisible(true)}>全选搜索结果中的新增课程</button><button className="text-button" type="button" disabled={!visible.length} onClick={() => selectVisible(false)}>取消选择搜索结果</button></div></div>
        <p className="course-selection-summary" role="status">显示 {visible.length} / {inRange.length} 节 · 已选新增 {additions.length} 节，确认更新 {approved.length} 节</p>
        <p className="privacy-note">搜索只筛选预览，隐藏的已选课程仍会导入。全选只选择新增课程，调课仍需逐节确认。</p>
        <div className="course-preview" aria-label="课表预览">{visible.length === 0 ? <p>{inRange.length ? '没有匹配的课程，请修改搜索词。' : '当前范围没有选中的课程，可以选择全部日期或勾选课程。'}</p> : visible.map((event) => {
          const action = classifyCourse(tasks, event)
          const overlap = courseOverlapCount(tasks, event)
          const old = tasks.find((task) => task.calendarImport?.calendarKey === event.calendarKey && task.calendarImport.eventKey === event.key)
          return <article className="course-preview-row" key={event.key}>
            <div>{action === 'new' ? <label className="course-lesson-choice"><input type="checkbox" aria-label={`导入${event.course}，${time(event.start)}`} checked={selectedLessons.has(event.key)} onChange={(change) => setSelectedLessons((previous) => { const next = new Set(previous); change.target.checked ? next.add(event.key) : next.delete(event.key); return next })} /><strong>{event.course}</strong></label> : <strong>{event.course}</strong>}<small>{time(event.start)} — {new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.parse(event.start) + event.duration * 60000))} · {event.duration} 分钟</small><small>{[event.location, event.teacher].filter(Boolean).join(' · ')}</small><small>{event.teachingClass}</small></div>
            <div className="course-row-action"><span>{ACTION_LABELS[action]}</span>{overlap > 0 && <small>与 {overlap} 项日程重叠，仅提示</small>}{(action === 'update' || action === 'local-edit') && <><small>本机：{old?.title} · {old?.start ? time(old.start) : '待安排'} · {old?.duration} 分钟</small><label><input type="checkbox" checked={updates.has(event.key)} onChange={(change) => setUpdates((previous) => { const next = new Set(previous); change.target.checked ? next.add(event.key) : next.delete(event.key); return next })} />{action === 'local-edit' ? '确认替换本节课的手动修改' : '确认更新本节课'}</label></>}</div>
          </article>
        })}</div>
        <p className="privacy-note">将新增 {additions.length} 节，更新 {approved.length} 节，其余跳过。{overlaps > 0 ? `${overlaps} 节与已有日程重叠，双方时间均保留。` : ''}本文件未列出的旧课程不会被删除。</p>
      </>}
      </div>
      <div className="dialog-actions course-import-actions">{canUndo && <button className="text-button" type="button" onClick={() => { onUndo(); onClose() }}><RotateCcw size={14} />撤销上次课表导入</button>}<button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="button" disabled={reading || !calendar || additions.length + approved.length === 0} onClick={apply}>确认导入课表</button></div>
    </section>
  </div>
}
