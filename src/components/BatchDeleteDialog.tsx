import { useEffect, useRef, useState } from 'react'
import { batchDeleteSummary } from '../batchDelete'
import type { Task } from '../types'

export interface BatchDeleteReview { tasks: Task[]; selected: Set<string> }

export default function BatchDeleteDialog({ review, onClose, onConfirm }: { review: BatchDeleteReview; onClose: () => void; onConfirm: (deleteChildren: boolean) => void }) {
  const [deleteChildren, setDeleteChildren] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const summary = batchDeleteSummary(review.tasks, review.selected)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section ref={dialogRef} className="edit-dialog batch-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-delete-title" aria-describedby="batch-delete-description" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key === 'Tab') {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button, input')
        if (!controls?.length) return
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }}>
      <h2 id="batch-delete-title">确认批量删除</h2>
      <p id="batch-delete-description">已选择 {summary.plans} 个长期计划{summary.schedules > 0 ? `、${summary.schedules} 个日程` : ''}。已勾选的日程会移入回收站；未勾选的子日程默认保留为普通日程。</p>
      {summary.children > 0 && <label className="batch-delete-children"><input type="checkbox" checked={deleteChildren} onChange={(event) => setDeleteChildren(event.target.checked)} /><span>同时删除这些计划下的全部子日程（{summary.children} 项，含已安排的日程）</span></label>}
      <p className="field-hint">删除长期计划后可立即点击“撤销”恢复；移入回收站的日程可随时恢复。</p>
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="button" className="danger-primary-button" onClick={() => onConfirm(deleteChildren)}>确认删除</button></div>
    </section>
  </div>
}
