import { Trash2 } from 'lucide-react'
import type { TaskColor, TaskStatus } from '../types'

interface Props {
  count: number
  hasPlans: boolean
  tags: string
  canAddTags: boolean
  onTags: (value: string) => void
  onSelectSchedules: () => void
  onSelectPlans: () => void
  onClear: () => void
  onDelete: () => void
  onStatus: (value: TaskStatus) => void
  onColor: (value: TaskColor) => void
  onStartReminder: (value: string) => void
  onEndReminder: (value: string) => void
  onAddTags: () => void
}

export default function BatchToolbar(props: Props) {
  return <section className="batch-toolbar" aria-label="日程批量管理">
    <div className="batch-selection-row">
      <strong aria-live="polite">已选择 {props.count} 项</strong>
      <div className="batch-selection-actions">
        <button className="text-button" type="button" disabled={!props.count} onClick={props.onClear}>取消选择</button>
        <button className="danger-button batch-delete" type="button" disabled={!props.count} onClick={props.onDelete}><Trash2 size={15} />一键删除</button>
      </div>
    </div>
    <details className="batch-more">
      <summary>更多操作</summary>
      <div className="batch-more-panel">
        <div className="batch-selection-actions"><button className="text-button" type="button" onClick={props.onSelectSchedules}>全选当前日程</button><button className="text-button" type="button" onClick={props.onSelectPlans}>全选长期计划</button></div>
        <small className="batch-help">全选当前日程仅包含当前日历视图与待安排区。</small>
        {!props.hasPlans && <div className="batch-actions">
      <select aria-label="批量修改状态" defaultValue="" disabled={!props.count} onChange={(event) => { props.onStatus(event.target.value as TaskStatus); event.currentTarget.value = '' }}><option value="" disabled>修改状态</option><option value="todo">待办</option><option value="in-progress">进行中</option><option value="completed">已完成</option></select>
      <select aria-label="批量修改颜色" defaultValue="" disabled={!props.count} onChange={(event) => { props.onColor(event.target.value as TaskColor); event.currentTarget.value = '' }}><option value="" disabled>修改颜色</option>{(['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'purple'] as TaskColor[]).map((color, index) => <option value={color} key={color}>{['红色', '橙色', '黄色', '绿色', '蓝色', '靛色', '紫色'][index]}</option>)}</select>
      <select aria-label="批量设置开始提醒" defaultValue="" disabled={!props.count} onChange={(event) => { props.onStartReminder(event.target.value); event.currentTarget.value = '' }}><option value="" disabled>开始提醒</option><option value="none">不提醒</option>{[0, 5, 10, 15, 30, 60, 1440].map((minutes) => <option key={minutes} value={minutes}>{minutes === 0 ? '开始时' : minutes === 1440 ? '提前 1 天' : minutes === 60 ? '提前 1 小时' : `提前 ${minutes} 分钟`}</option>)}</select>
      <select aria-label="批量设置结束提醒" defaultValue="" disabled={!props.count} onChange={(event) => { props.onEndReminder(event.target.value); event.currentTarget.value = '' }}><option value="" disabled>结束提醒</option><option value="on">开启</option><option value="off">关闭</option></select>
      <input aria-label="批量添加标签" placeholder="添加标签" value={props.tags} onChange={(event) => props.onTags(event.target.value)} />
      <button className="secondary-button" type="button" disabled={!props.count || !props.canAddTags} onClick={props.onAddTags}>添加标签</button>
        </div>}
      </div>
    </details>
  </section>
}
