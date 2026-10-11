import { durationFromTimes, endFromDuration, parseDurationInput } from '../scheduling'

export default function TimeFields({ prefix, start, duration, end, mode, onStart, onDuration, onEnd, onMode }: {
  prefix: string; start: string; duration: string; end: string; mode: 'duration' | 'end'
  onStart: (value: string) => void; onDuration: (value: string) => void; onEnd: (value: string) => void; onMode: (mode: 'duration' | 'end') => void
}) {
  const calculated = durationFromTimes(start, end)
  function switchMode(next: 'duration' | 'end') {
    if (next === mode) return
    if (next === 'end') onEnd(endFromDuration(start, duration))
    else if (calculated !== null) onDuration(String(calculated))
    onMode(next)
  }
  function changeStart(value: string) {
    if (mode === 'end' && calculated !== null) onDuration(String(calculated))
    if (mode === 'end' && start && calculated !== null) onEnd(endFromDuration(value, String(calculated)))
    else if (mode === 'end' && !end) onEnd(endFromDuration(value, duration))
    onStart(value)
  }
  const resultEnd = mode === 'end' ? end : endFromDuration(start, duration)
  const resultDuration = mode === 'end' && start ? calculated : parseDurationInput(duration)
  return <div className="time-fields">
    <div className="time-mode" role="group" aria-label="时间输入方式"><button type="button" aria-pressed={mode === 'end'} onClick={() => switchMode('end')}>开始 + 结束</button><button type="button" aria-pressed={mode === 'duration'} onClick={() => switchMode('duration')}>开始 + 时长</button></div>
    <label htmlFor={`${prefix}-start`}>开始时间（可暂不安排）</label><input id={`${prefix}-start`} type="datetime-local" step="60" value={start} onChange={(event) => changeStart(event.target.value)} />
    {mode === 'end' && start ? <><label htmlFor={`${prefix}-end`}>结束时间</label><input id={`${prefix}-end`} type="datetime-local" step="60" required value={end} onChange={(event) => onEnd(event.target.value)} /><p className="time-result" aria-live="polite">预计时长：{resultDuration === null ? '结束时间须晚于开始时间，且间隔不超过 720 分钟' : `${resultDuration} 分钟`}</p></> : <><label htmlFor={`${prefix}-duration`}>预计时长（分钟）</label><input id={`${prefix}-duration`} className="duration-input" type="number" inputMode="numeric" min="1" max="720" step="1" required value={duration} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onDuration(event.target.value)} />{start && <p className="time-result" aria-live="polite">结束时间：{resultEnd.replace('T', ' ') || '请填写有效时长'}</p>}</>}
    <small className="field-hint">精确到分钟。未设置开始时间时，只记录预计时长。</small>
  </div>
}
