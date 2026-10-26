import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { AlertTriangle, Check, Cloud, CloudOff, KeyRound, LogOut, Mail, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { cloudClient, cloudConfigured, cloudSyncBlockedByOrigin } from '../cloudClient'
import { classifyIncomingCloudSnapshot, classifyInitialSync, cloudDataMatches, cloudSyncErrorMessage, loginErrorMessage, otpVerificationErrorMessage, parseCloudSnapshot, taskFingerprint, type CloudSnapshot } from '../cloudData'
import { loadCloudBase, loadCloudRecovery, saveCloudBase, saveCloudRecovery, type CloudRecoveryEntry } from '../cloudRecovery'
import type { Task } from '../types'

type SyncPhase = 'local' | 'loading' | 'syncing' | 'synced' | 'offline' | 'error' | 'conflict'
type ConfirmAction = 'signout' | 'delete-cloud'
type Resolution = 'initial-local' | 'initial-cloud' | 'conflict-local' | 'conflict-cloud'

interface InitialChoice { cloud: CloudSnapshot | null; localCount: number }
interface SyncConflict { cloud: CloudSnapshot | null }
interface CloudSyncProps { tasks: Task[]; setTasks: Dispatch<SetStateAction<Task[]>>; onNotify: (message: string) => void }

function syncLabel(phase: SyncPhase) {
  if (phase === 'loading') return '正在读取云端'
  if (phase === 'syncing') return '正在同步'
  if (phase === 'synced') return '已同步'
  if (phase === 'offline') return '离线，等待恢复网络'
  if (phase === 'error') return '同步失败'
  if (phase === 'conflict') return '需要选择保留版本'
  return '本机模式'
}

function formatSyncTime(value: string | null) {
  if (!value) return '尚未同步'
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

export default function CloudSync({ tasks, setTasks, onNotify }: CloudSyncProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [phase, setPhase] = useState<SyncPhase>('local')
  const [messageSent, setMessageSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [initialChoice, setInitialChoice] = useState<InitialChoice | null>(null)
  const [conflict, setConflict] = useState<SyncConflict | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [cloudCount, setCloudCount] = useState(0)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [syncAttempt, setSyncAttempt] = useState(0)
  const [syncWake, setSyncWake] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [recoveryEntries, setRecoveryEntries] = useState<CloudRecoveryEntry[]>([])
  const [selectedRecovery, setSelectedRecovery] = useState(0)
  const [emptyConfirmation, setEmptyConfirmation] = useState<{ resolution: Resolution; local: string; cloud: string } | null>(null)
  const [resolving, setResolving] = useState(false)
  const [conflictVisible, setConflictVisible] = useState(true)
  const [localUpdatedAt, setLocalUpdatedAt] = useState<string | null>(null)
  const tasksRef = useRef(tasks)
  const replaceTasksRef = useRef(setTasks)
  const notifyRef = useRef(onNotify)
  const lastCloudFingerprint = useRef<string | null>(null)
  const lastCloudRevision = useRef<number | null>(null)
  const lastCloudSnapshot = useRef<CloudSnapshot | null>(null)
  const lastCloudTasks = useRef<Task[]>([])
  // Observed revisions are for compare-and-swap. Only accepted/acknowledged data
  // advances the common baseline used to distinguish one-sided edits.
  const syncBase = useRef<string | null>(null)
  const uncertainWrite = useRef<string | null>(null)
  const connectionGeneration = useRef(0)
  const latestUploadId = useRef(0)
  const uploadQueue = useRef<Promise<void>>(Promise.resolve())
  const syncPaused = useRef(true)
  const activeUser = useRef(userId)
  activeUser.current = userId

  function pauseForConflict(snapshot: CloudSnapshot | null) {
    rememberCloud(snapshot)
    syncPaused.current = true
    setInitialChoice(null); setConflict({ cloud: snapshot }); setPhase('conflict')
  }

  function markReady() { syncPaused.current = false; setReady(true) }

  useEffect(() => {
    if (!cloudDataMatches(tasksRef.current, tasks)) setLocalUpdatedAt(new Date().toISOString())
    tasksRef.current = tasks
  }, [tasks])
  useEffect(() => { replaceTasksRef.current = setTasks }, [setTasks])
  useEffect(() => { notifyRef.current = onNotify }, [onNotify])
  useEffect(() => {
    if (resendSeconds <= 0) return
    const timer = window.setTimeout(() => setResendSeconds((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendSeconds])

  function rememberCloud(snapshot: CloudSnapshot | null) {
    lastCloudFingerprint.current = snapshot ? taskFingerprint(snapshot.tasks) : taskFingerprint([])
    lastCloudRevision.current = snapshot?.revision ?? null
    lastCloudSnapshot.current = snapshot
    lastCloudTasks.current = snapshot?.tasks ?? []
    setCloudCount(snapshot?.tasks.length ?? 0)
    setLastSyncedAt(snapshot?.updatedAt ?? null)
  }

  function acceptCloud(snapshot: CloudSnapshot | null) {
    rememberCloud(snapshot)
    syncBase.current = taskFingerprint(snapshot?.tasks ?? [])
    uncertainWrite.current = null
    if (userId) saveCloudBase(userId, syncBase.current)
  }

  function checkpoint(tasksToSave: Task[], reason: string) {
    if (!userId || tasksToSave.length === 0) return true
    const saved = saveCloudRecovery(userId, tasksToSave, reason)
    if (!saved) return false
    setRecoveryEntries(saved)
    setSelectedRecovery(0)
    return true
  }

  function applyCloudTasks(tasksToApply: Task[], reason: string) {
    if (taskFingerprint(tasksRef.current) === taskFingerprint(tasksToApply)) return true
    if (!checkpoint(tasksRef.current, reason)) {
      syncPaused.current = true
      setPhase('error'); setSyncError('无法创建恢复点，已阻止覆盖本机日程。请检查浏览器存储空间。')
      return false
    }
    replaceTasksRef.current(tasksToApply)
    tasksRef.current = tasksToApply
    return true
  }

  const upload = useCallback(async (nextTasks: Task[], notify = false, allowEmptyOverwrite = false, resolvingChoice = false) => {
    if (!cloudClient || !userId) return false
    const client = cloudClient
    const generation = connectionGeneration.current
    const isCurrent = () => activeUser.current === userId && connectionGeneration.current === generation
    const uploadId = latestUploadId.current + 1
    latestUploadId.current = uploadId
    const operation = uploadQueue.current.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!isCurrent() || (syncPaused.current && !resolvingChoice)) return false
        if (!cloudDataMatches(nextTasks, tasksRef.current)) return false
        if (!navigator.onLine) { setPhase('offline'); return false }
        if (nextTasks.length === 0 && lastCloudTasks.current.length > 0 && !allowEmptyOverwrite) {
          pauseForConflict(lastCloudSnapshot.current)
          setSyncError('为防止误清空，空日程不会自动覆盖已有云端内容。请明确选择保留哪一版。')
          return false
        }
        if (lastCloudTasks.current.length > 0 && !cloudDataMatches(lastCloudTasks.current, nextTasks) && !checkpoint(lastCloudTasks.current, '覆盖云端前')) {
          setPhase('error'); setSyncError('无法创建云端恢复点，已阻止覆盖。请检查浏览器存储空间。'); return false
        }
        setPhase('syncing'); setSyncError(null)
        const expectedRevision = lastCloudRevision.current
        const previousUncertainWrite = uncertainWrite.current
        uncertainWrite.current = taskFingerprint(nextTasks)
        const response = expectedRevision === null
          ? await client.from('workgrid_data').insert({ user_id: userId, tasks: nextTasks }).select('tasks, revision, updated_at').single()
          : await client.from('workgrid_data').update({ tasks: nextTasks }).eq('user_id', userId).eq('revision', expectedRevision).select('tasks, revision, updated_at').maybeSingle()
        if (!isCurrent()) return false
        if (!response.data && (!response.error || response.error.code === '23505')) {
          // A revision mismatch can be a repeated write or a lost response. Read
          // and compare content before asking the user to resolve anything.
          const latest = await client.from('workgrid_data').select('tasks, revision, updated_at').eq('user_id', userId).maybeSingle()
          if (!isCurrent()) return false
          if (latest.error) throw latest.error
          const snapshot = latest.data ? parseCloudSnapshot(latest.data) : null
          if (snapshot && lastCloudRevision.current !== null && snapshot.revision < lastCloudRevision.current) continue
          const remoteTasks = snapshot?.tasks ?? []
          const action = classifyIncomingCloudSnapshot(tasksRef.current, syncBase.current, remoteTasks)
          if (action === 'unchanged' || taskFingerprint(remoteTasks) === uncertainWrite.current || taskFingerprint(remoteTasks) === previousUncertainWrite) {
            acceptCloud(snapshot)
            if (cloudDataMatches(remoteTasks, tasksRef.current)) { setPhase('synced'); return true }
            if (!syncPaused.current || resolvingChoice) continue
            return false
          }
          if (action === 'upload-local' && !(remoteTasks.length === 0 && nextTasks.length > 0)) {
            rememberCloud(snapshot); continue
          }
          if (action === 'apply-cloud' && remoteTasks.length > 0 && !syncPaused.current) {
            if (!applyCloudTasks(remoteTasks, '同步云端前')) return false
            acceptCloud(snapshot); setPhase('synced'); return true
          }
          pauseForConflict(snapshot)
          notifyRef.current('检测到两边不同的修改，自动同步已暂停')
          return false
        }
        if (response.error) throw response.error
        const snapshot = parseCloudSnapshot(response.data)
        // Realtime may already have delivered a newer remote revision.
        if (lastCloudRevision.current !== null && snapshot.revision < lastCloudRevision.current) return false
        acceptCloud(snapshot)
        if (syncPaused.current && !resolvingChoice) return false
        setPhase(cloudDataMatches(snapshot.tasks, tasksRef.current) ? 'synced' : 'syncing')
        if (!cloudDataMatches(snapshot.tasks, tasksRef.current)) setSyncWake((current) => current + 1)
        if (notify) notifyRef.current('已同步到云端')
        return true
      }
      setPhase('error'); setSyncError('云端版本持续变化，本机修改已保留，请稍后重试。'); return false
    }).catch((caught) => {
      if (isCurrent() && (resolvingChoice || !syncPaused.current) && uploadId === latestUploadId.current) { setPhase(navigator.onLine ? 'error' : 'offline'); setSyncError(cloudSyncErrorMessage(caught)) }
      return false
    })
    uploadQueue.current = operation.then(() => undefined, () => undefined)
    return operation
  }, [userId])

  useEffect(() => {
    if (!cloudClient) return
    let active = true
    cloudClient.auth.getSession().then(({ data }) => {
      if (!active) return
      setUserId(data.session?.user.id ?? null); setUserEmail(data.session?.user.email ?? null)
    })
    const { data: listener } = cloudClient.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null); setUserEmail(session?.user.email ?? null)
      if (session) { setMessageSent(false); setOtp(''); setSyncError(null); setResendSeconds(0) }
      else {
        syncPaused.current = true
        setReady(false); setInitialChoice(null); setConflict(null); setConfirmAction(null); setEmptyConfirmation(null); setPhase('local'); setLastSyncedAt(null); setCloudCount(0)
        connectionGeneration.current++
        lastCloudFingerprint.current = null; lastCloudRevision.current = null; lastCloudSnapshot.current = null; lastCloudTasks.current = []; syncBase.current = null; uncertainWrite.current = null; setRecoveryEntries([])
      }
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!cloudClient || !userId) return
    let active = true
    connectionGeneration.current++
    syncPaused.current = true
    setReady(false); setInitialChoice(null); setConflict(null); setEmptyConfirmation(null); setPhase('loading'); setSyncError(null)
    lastCloudFingerprint.current = null; lastCloudRevision.current = null; lastCloudSnapshot.current = null; lastCloudTasks.current = []
    syncBase.current = loadCloudBase(userId); uncertainWrite.current = null
    setConflictVisible(true)
    setSelectedRecovery(0)
    setRecoveryEntries(loadCloudRecovery(userId))
    cloudClient.from('workgrid_data').select('tasks, revision, updated_at').eq('user_id', userId).maybeSingle().then(({ data, error }) => {
      if (!active) return
      if (error) { setPhase(navigator.onLine ? 'error' : 'offline'); setSyncError(cloudSyncErrorMessage(error)); return }
      if (!data) {
        rememberCloud(null)
        const previousFingerprint = loadCloudBase(userId)
        const action = classifyInitialSync(tasksRef.current, [], previousFingerprint)
        if (!previousFingerprint && tasksRef.current.length > 0) { setInitialChoice({ cloud: null, localCount: tasksRef.current.length }); return }
        if (action === 'upload-local') upload(tasksRef.current, false, false, true).then((ok) => { if (ok && active) markReady() })
        else if (action === 'synced') upload([], false, false, true).then((ok) => { if (ok && active) markReady() })
        else setInitialChoice({ cloud: null, localCount: tasksRef.current.length })
        return
      }
      try {
        const snapshot = parseCloudSnapshot(data)
        rememberCloud(snapshot)
        const previousFingerprint = loadCloudBase(userId)
        const action = classifyInitialSync(tasksRef.current, snapshot.tasks, previousFingerprint)
        if (!previousFingerprint && tasksRef.current.length > 0 && snapshot.tasks.length > 0 && !cloudDataMatches(tasksRef.current, snapshot.tasks)) {
          setInitialChoice({ cloud: snapshot, localCount: tasksRef.current.length }); return
        }
        if (action === 'synced') { acceptCloud(snapshot); markReady(); setPhase('synced') }
        else if (action === 'apply-cloud') {
          if (applyCloudTasks(snapshot.tasks, '同步云端前')) { acceptCloud(snapshot); markReady(); setPhase('synced') }
        } else if (action === 'upload-local') upload(tasksRef.current, false, false, true).then((ok) => { if (ok && active) markReady() })
        else setInitialChoice({ cloud: snapshot, localCount: tasksRef.current.length })
      } catch (caught) { setPhase('error'); setSyncError(caught instanceof Error ? caught.message : '云端数据无法读取') }
    })
    return () => { active = false; connectionGeneration.current++; syncPaused.current = true }
  }, [userId, upload, syncAttempt])

  useEffect(() => {
    if (!cloudClient || !userId || !ready || conflict || syncPaused.current) return
    if (taskFingerprint(tasks) === lastCloudFingerprint.current) return
    const timer = window.setTimeout(() => upload(tasks), 700)
    return () => window.clearTimeout(timer)
  }, [tasks, userId, ready, conflict, upload, syncWake])

  useEffect(() => {
    if (!cloudClient || !userId || !ready) return
    const client = cloudClient
    let active = true
    const channel = client.channel(`workgrid:${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'workgrid_data', filter: `user_id=eq.${userId}` }, (payload) => {
      // Process notifications in the same queue as writes. A self-notification
      // cannot advance the revision halfway through its HTTP acknowledgement.
      const incoming = uploadQueue.current.then(() => {
        if (!active || activeUser.current !== userId) return
        if (payload.eventType === 'DELETE') {
          if (tasksRef.current.length > 0) pauseForConflict(null)
          else { acceptCloud(null); setPhase('synced') }
          return
        }
        const snapshot = parseCloudSnapshot(payload.new)
        if (lastCloudRevision.current !== null && snapshot.revision <= lastCloudRevision.current) return
        if (taskFingerprint(snapshot.tasks) === uncertainWrite.current) {
          acceptCloud(snapshot)
          setPhase(cloudDataMatches(tasksRef.current, snapshot.tasks) ? 'synced' : 'syncing')
          setSyncWake((current) => current + 1)
          return
        }
        if (syncPaused.current) { rememberCloud(snapshot); pauseForConflict(snapshot); return }
        const action = classifyIncomingCloudSnapshot(tasksRef.current, syncBase.current, snapshot.tasks)
        if (action === 'conflict' || (snapshot.tasks.length === 0 && tasksRef.current.length > 0)) pauseForConflict(snapshot)
        else if (action === 'upload-local') { rememberCloud(snapshot); setPhase('syncing'); setSyncWake((current) => current + 1) }
        else {
          if (action === 'apply-cloud' && !applyCloudTasks(snapshot.tasks, '同步云端前')) return
          acceptCloud(snapshot)
          setPhase('synced')
        }
      }).catch(() => { if (active) { setPhase('error'); setSyncError('收到的云端数据格式不正确') } })
      uploadQueue.current = incoming
    }).subscribe()
    return () => { active = false; client.removeChannel(channel) }
  }, [userId, ready])

  useEffect(() => { if (userId) setRecoveryEntries(loadCloudRecovery(userId)) }, [userId])

  useEffect(() => {
    function offline() { if (userId) setPhase('offline') }
    function online() { if (!userId) return; if (ready && !conflict) upload(tasksRef.current); else if (!conflict) setSyncAttempt((current) => current + 1) }
    window.addEventListener('offline', offline); window.addEventListener('online', online)
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online) }
  }, [userId, ready, conflict, upload])

  if (cloudSyncBlockedByOrigin) return <div className="cloud-sync"><button className="icon-button cloud-sync-button phase-offline" type="button" aria-label="云同步仅在正式网站启用" title="此测试/临时网站已禁用云同步，避免改动正式数据" disabled><CloudOff size={18} /></button></div>
  if (!cloudConfigured || !cloudClient) return null

  async function requestLoginCode(normalized: string) {
    setSubmitting(true); setSyncError(null)
    try {
      const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).href
      const { error } = await cloudClient!.auth.signInWithOtp({ email: normalized, options: { emailRedirectTo: redirectTo } })
      if (error) { setSyncError(loginErrorMessage(error)); return false }
      setMessageSent(true); setOtp(''); setResendSeconds(60); return true
    } catch (caught) { setSyncError(loginErrorMessage(caught)); return false
    } finally { setSubmitting(false) }
  }

  async function sendLoginCode(event: React.FormEvent) { event.preventDefault(); const normalized = email.trim().toLowerCase(); if (normalized) await requestLoginCode(normalized) }
  async function verifyLoginCode(event: React.FormEvent) {
    event.preventDefault(); const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || otp.length < 6 || otp.length > 8) return
    setVerifying(true); setSyncError(null)
    try { const { error } = await cloudClient!.auth.verifyOtp({ email: normalizedEmail, token: otp, type: 'email' }); if (error) setSyncError(otpVerificationErrorMessage(error))
    } catch (caught) { setSyncError(otpVerificationErrorMessage(caught))
    } finally { setVerifying(false) }
  }
  async function resendLoginCode() { if (resendSeconds > 0 || submitting) return; await requestLoginCode(email.trim().toLowerCase()) }
  function changeLoginEmail() { setMessageSent(false); setOtp(''); setSyncError(null); setResendSeconds(0) }
  async function chooseLocal(allowEmpty = false) { const ok = await upload(tasksRef.current, true, allowEmpty, true); if (ok) { setInitialChoice(null); markReady() } }
  function chooseCloud() {
    if (!initialChoice?.cloud) return
    if (!applyCloudTasks(initialChoice.cloud.tasks, '载入云端前')) return
    acceptCloud(initialChoice.cloud)
    setInitialChoice(null); markReady(); setPhase('synced'); setSyncError(null); notifyRef.current('已载入云端日程，替换前版本可在云同步中恢复')
  }
  function resolveWithCloud() {
    const cloudTasks = conflict?.cloud?.tasks ?? []
    if (!applyCloudTasks(cloudTasks, '保留云端版本前')) return
    acceptCloud(conflict?.cloud ?? null)
    setConflict(null); markReady(); setPhase('synced'); setSyncError(null); notifyRef.current('已保留云端版本，替换前版本可在云同步中恢复')
  }
  async function resolveWithLocal() {
    if (!conflict) return
    const ok = await upload(tasksRef.current, true, true, true)
    if (ok) { setConflict(null); markReady() }
  }
  async function requestResolution(resolution: Resolution, confirmed = false) {
    if (resolving) return
    const localTasks = tasksRef.current
    const snapshot = resolution.startsWith('initial') ? initialChoice?.cloud : conflict?.cloud
    const cloudTasks = snapshot?.tasks ?? []
    const incoming = resolution.endsWith('local') ? localTasks : cloudTasks
    const outgoing = resolution.endsWith('local') ? cloudTasks : localTasks
    if (!confirmed && incoming.length === 0 && outgoing.length > 0) {
      setEmptyConfirmation({ resolution, local: taskFingerprint(localTasks), cloud: taskFingerprint(cloudTasks) }); return
    }
    if (confirmed && (emptyConfirmation?.local !== taskFingerprint(localTasks) || emptyConfirmation?.cloud !== taskFingerprint(cloudTasks))) {
      setEmptyConfirmation(null); setSyncError('日程已发生变化，请重新核对两边数量后选择。'); return
    }
    setResolving(true)
    try {
      if (resolution === 'initial-local') await chooseLocal(confirmed)
      else if (resolution === 'initial-cloud') chooseCloud()
      else if (resolution === 'conflict-local') await resolveWithLocal()
      else resolveWithCloud()
    } finally { setResolving(false); setEmptyConfirmation(null) }
  }
  function restoreRecovery(entry: CloudRecoveryEntry) {
    if (!ready || syncPaused.current || resolving) return
    if (!checkpoint(tasksRef.current, '恢复前')) {
      setPhase('error'); setSyncError('无法创建当前版本的恢复点，暂未恢复。请检查浏览器存储空间。'); return
    }
    replaceTasksRef.current(entry.tasks)
    tasksRef.current = entry.tasks
    setMenuOpen(false)
    notifyRef.current('已恢复本机恢复点，正在同步')
  }
  async function performSignOut() {
    await cloudClient!.auth.signOut(); setConfirmAction(null); setMenuOpen(false)
    notifyRef.current('已退出云同步，本机日程仍会保留')
  }
  async function deleteCloudData() {
    if (!userId) return
    setDeleting(true); setSyncError(null)
    const { error } = await cloudClient!.from('workgrid_data').delete().eq('user_id', userId)
    if (error) { setDeleting(false); setConfirmAction(null); setPhase(navigator.onLine ? 'error' : 'offline'); setSyncError(cloudSyncErrorMessage(error)); return }
    await cloudClient!.auth.signOut(); setDeleting(false); setConfirmAction(null); setMenuOpen(false)
    notifyRef.current('云端数据已删除，本机日程仍会保留')
  }
  function retrySync() { if (ready && !syncPaused.current) upload(tasksRef.current, true); else setSyncAttempt((current) => current + 1) }

  const pendingCount = conflict || (ready && taskFingerprint(tasks) !== lastCloudFingerprint.current) ? 1 : 0

  return <div className="cloud-sync">
    <button className={`icon-button cloud-sync-button phase-${phase}${menuOpen ? ' is-active' : ''}`} type="button" aria-label="云同步" title={`云同步：${syncLabel(phase)}`} onClick={() => { if (conflict) { setMenuOpen(false); setConflictVisible(true) } else setMenuOpen((current) => !current) }}>
      {phase === 'offline' || phase === 'error' || phase === 'conflict' ? <CloudOff size={18} /> : phase === 'syncing' || phase === 'loading' ? <RefreshCw className="spin" size={18} /> : <Cloud size={18} />}
      {userId && <span className="sync-indicator" aria-hidden="true" />}
    </button>

    {menuOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setMenuOpen(false)}>
      <section className="data-dialog account-dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-heading"><div className="dialog-title"><span className="dialog-icon"><Cloud size={18} /></span><div><h2 id="cloud-title">云同步</h2><p>{userId ? '账户与同步状态' : '登录后在不同设备使用同一份日程'}</p></div></div><button className="icon-button" type="button" aria-label="关闭" onClick={() => setMenuOpen(false)}><X size={18} /></button></div>
        {!userId ? messageSent ? <form onSubmit={verifyLoginCode}>
          <div className="login-sent"><span><Check size={18} /></span><strong>验证码已发送</strong><p>已发送至 {email.trim().toLowerCase()}，也可以使用邮件中的登录链接。</p></div>
          <label htmlFor="cloud-otp">邮箱验证码</label><div className="cloud-email-row otp-row"><KeyRound size={17} /><input id="cloud-otp" className="otp-input" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} required value={otp} onChange={(event) => { setOtp(event.target.value.replace(/\D/g, '').slice(0, 8)); setSyncError(null) }} placeholder="输入 6 至 8 位验证码" /></div>
          {syncError && <div className="error-message login-error" role="alert"><CloudOff size={17} />{syncError}</div>}
          <div className="login-resend"><button className="text-button" type="button" disabled={resendSeconds > 0 || submitting} onClick={resendLoginCode}>{resendSeconds > 0 ? `${resendSeconds} 秒后可重新发送` : submitting ? '正在发送...' : '重新发送验证码'}</button><button className="text-button" type="button" onClick={changeLoginEmail}>更换邮箱</button></div>
          <div className="dialog-actions"><button className="primary-button" type="submit" disabled={verifying || otp.length < 6 || otp.length > 8}>{verifying ? '正在验证...' : '验证并登录'}</button></div>
        </form> : <form onSubmit={sendLoginCode}>
          <label htmlFor="cloud-email">邮箱</label><div className="cloud-email-row"><Mail size={17} /><input id="cloud-email" type="email" autoComplete="email" required value={email} onChange={(event) => { setEmail(event.target.value); setSyncError(null) }} placeholder="name@example.com" /></div><p className="privacy-note">每个账户的数据相互隔离，不会公开给其他用户。</p>{syncError && <div className="error-message login-error" role="alert"><CloudOff size={17} />{syncError}</div>}<div className="dialog-actions"><button className="primary-button" type="submit" disabled={submitting}>{submitting ? '正在发送...' : '发送验证码'}</button></div>
        </form> : <>
          <div className="account-summary"><div><span>账户</span><strong>{userEmail}</strong></div><div><span>同步状态</span><strong className={`sync-phase phase-${phase}`}>{syncLabel(phase)}</strong></div><div><span>云端内容</span><strong>{cloudCount} 个工作方块</strong></div><div><span>待上传</span><strong>{pendingCount ? '有本机修改' : '无'}</strong></div><div><span>最近同步</span><strong>{formatSyncTime(lastSyncedAt)}</strong></div><div><span>失败原因</span><strong>{syncError ?? '无'}</strong></div></div>
          {syncError && <div className="error-message" role="alert"><CloudOff size={17} />同步暂不可用，本机数据仍已保存。</div>}
          <div className="account-tools">
            {recoveryEntries[0] && <div className="cloud-recovery-tools"><label>本机恢复点<select aria-label="选择恢复点" value={selectedRecovery} onChange={(event) => setSelectedRecovery(Number(event.target.value))}>{recoveryEntries.map((entry, index) => <option key={`${entry.savedAt}-${index}`} value={index}>恢复点：{entry.tasks.length} 项 · {formatSyncTime(entry.savedAt)} · {entry.reason}</option>)}</select></label><button className="text-button" type="button" disabled={!ready || phase === 'conflict' || resolving} onClick={() => restoreRecovery(recoveryEntries[selectedRecovery])}>恢复并同步</button><small>仅保存在此浏览器，清除网站数据会丢失。最多保留 5 个版本。</small></div>}
            <button className="text-button danger-text-button" type="button" onClick={() => setConfirmAction('delete-cloud')}><Trash2 size={15} />删除云端数据</button>
          </div>
          <div className="dialog-actions"><button className="secondary-button account-signout" type="button" onClick={() => setConfirmAction('signout')}><LogOut size={15} />退出登录</button><button className="primary-button" type="button" disabled={phase === 'syncing' || phase === 'loading' || phase === 'conflict'} onClick={retrySync}><RefreshCw size={15} />{ready ? '立即同步' : '重试连接'}</button></div>
        </>}
      </section>
    </div>}

    {initialChoice && <div className="modal-backdrop sync-choice-backdrop" role="presentation">
      <section className="data-dialog sync-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-choice-title">
        <div className="dialog-heading"><div className="dialog-title"><span className="dialog-icon"><Upload size={18} /></span><div><h2 id="sync-choice-title">选择首次同步数据</h2><p>仅首次连接或两边都有不同内容时需要选择</p></div></div></div>
        <div className="sync-choice-grid"><div><span>本机</span><strong>{tasks.length} 个工作方块</strong></div><div><span>云端</span><strong>{initialChoice.cloud ? `${initialChoice.cloud.tasks.length} 个工作方块` : '暂无数据'}</strong></div></div>
        <p className="privacy-note">日常修改会自动同步，不需要反复选择。选择前会在本机保存恢复点；如果某一侧为空、另一侧有日程，系统会优先保留有内容的一侧。</p>
        <div className="dialog-actions sync-choice-actions"><button className="text-button" type="button" disabled={resolving} onClick={performSignOut}>暂不连接</button>{initialChoice.cloud && <button className="secondary-button" type="button" disabled={resolving} onClick={() => requestResolution('initial-cloud')}>用云端日程替换此设备</button>}<button className="primary-button" type="button" disabled={resolving} onClick={() => requestResolution('initial-local')}><Upload size={15} />上传本机日程到云端</button></div>
      </section>
    </div>}

    {conflict && conflictVisible && <div className="modal-backdrop conflict-backdrop" role="presentation">
      <section className="data-dialog conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <div className="dialog-heading"><div className="dialog-title"><span className="dialog-icon warning-dialog-icon"><AlertTriangle size={18} /></span><div><h2 id="conflict-title">发现同步冲突</h2><p>两边内容存在差异，需要核对</p></div></div></div>
        <p className="conflict-copy">自动同步已暂停。请选择要保留的完整版本，未选择前两边的数据都不会被覆盖。</p>
        <div className="sync-choice-grid conflict-grid"><div><span>本机版本</span><strong>{tasks.length} 个工作方块</strong><small>{localUpdatedAt ? `本次打开后修改于 ${formatSyncTime(localUpdatedAt)}` : '当前设备保存的版本'}</small></div><div><span>云端版本</span><strong>{conflict.cloud ? `${conflict.cloud.tasks.length} 个工作方块` : '云端已清空'}</strong><small>{conflict.cloud ? `更新于 ${formatSyncTime(conflict.cloud.updatedAt)}` : '可能由另一台设备删除'}</small></div></div>
        <p className="privacy-note">保留本机会用当前设备的数据更新云端；保留云端会替换当前设备中的日程。建议不确定时先导出备份。</p>
        <div className="dialog-actions conflict-actions"><button className="text-button" type="button" disabled={resolving} onClick={() => { setConflictVisible(false); setMenuOpen(false); notifyRef.current('同步已暂停，可继续编辑本机日程；点击云同步重新处理') }}>稍后处理</button><button className="secondary-button" type="button" disabled={resolving} onClick={() => requestResolution('conflict-cloud')}>保留云端版本</button><button className="primary-button" type="button" disabled={resolving} onClick={() => requestResolution('conflict-local')}>保留本机版本</button></div>
      </section>
    </div>}

    {emptyConfirmation && <div className="modal-backdrop confirm-cloud-backdrop" role="presentation">
      <section className="edit-dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="empty-sync-confirm-title">
        <div className="warning-icon"><AlertTriangle size={22} /></div>
        <h2 id="empty-sync-confirm-title">确认用空日程覆盖有内容的一侧？</h2>
        <p>你选择保留的一侧没有日程，另一侧有内容。继续后，有内容的那一侧会被清空；当前设备已有日程会先保存到本机恢复点。</p>
        <div className="dialog-actions"><button className="secondary-button" type="button" disabled={resolving} onClick={() => setEmptyConfirmation(null)}>返回检查</button><button className="danger-primary-button" type="button" disabled={resolving} onClick={() => requestResolution(emptyConfirmation.resolution, true)}>{resolving ? '正在处理...' : '确认清空并继续'}</button></div>
      </section>
    </div>}

    {confirmAction && <div className="modal-backdrop confirm-cloud-backdrop" role="presentation" onMouseDown={() => !deleting && setConfirmAction(null)}>
      <section className="edit-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="warning-icon"><AlertTriangle size={22} /></div>
        <h2 id="cloud-confirm-title">{confirmAction === 'delete-cloud' ? '删除云端数据？' : '退出云同步？'}</h2>
        <p>{confirmAction === 'delete-cloud' ? '云端日程会被永久删除并退出登录，本机日程不受影响。其他已登录设备可能仍保留本机副本。' : `退出后本机日程仍会保留，${pendingCount ? '当前待上传修改不会同步到其他设备。' : '之后的修改不会同步到其他设备。'}`}</p>
        <div className="dialog-actions"><button className="secondary-button" type="button" disabled={deleting} onClick={() => setConfirmAction(null)}>取消</button><button className={confirmAction === 'delete-cloud' ? 'danger-primary-button' : 'primary-button'} type="button" disabled={deleting} onClick={confirmAction === 'delete-cloud' ? deleteCloudData : performSignOut}>{deleting ? '正在删除...' : confirmAction === 'delete-cloud' ? '确认删除' : '确认退出'}</button></div>
      </section>
    </div>}
  </div>
}
