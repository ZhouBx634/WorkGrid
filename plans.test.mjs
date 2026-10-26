import assert from 'node:assert/strict'
import { createPlan, deadlineLabel, duePlanReminders, mergePlanParts, orderedPlans, pendingPlanGroups, planChildren, planStats, removePlan, reorderPlans, splitPlan, updatePlanDefinition } from './src/plans.ts'
import { createBackup, parseBackupText, planImport, validateTaskList } from './src/backup.ts'
import { parseCloudSnapshot, cloudDataMatches, taskFingerprint, classifyIncomingCloudSnapshot } from './src/cloudData.ts'
import { durationFromTimes, endFromDuration } from './src/scheduling.ts'
import { batchDeleteSummary, deleteSelectedTasks } from './src/batchDelete.ts'

const definition = { type: 'countable', totalUnits: 10, unitLabel: '节', deadline: null, notes: '', reminderMinutes: null }
const plan = createPlan('高数网课', 'blue', 90, definition)
const ordinary = { ...createPlan('原日程', 'red', 60, definition) }; delete ordinary.planDefinition
const original = JSON.stringify(ordinary)
let tasks = splitPlan([ordinary, plan], plan.id, 1)
assert.equal(planChildren(tasks, plan.id).length, 10)
assert.equal(JSON.stringify(tasks[0]), original)
assert.equal(splitPlan(tasks, plan.id, 1), tasks)
assert.deepEqual(planStats(tasks, plan), { total: 10, scheduled: 0, completed: 0, waiting: 10, ungenerated: 0 })
assert.deepEqual(validateTaskList(tasks).map(t => t.planAllocation?.units).filter(Boolean).flat(), Array.from({length:10}, (_,i)=>i+1))
const children = planChildren(tasks, plan.id)
tasks = mergePlanParts(tasks, plan.id, new Set([children[0].id, children[1].id]))
const merged = planChildren(tasks, plan.id).find(t => t.planAllocation.units.length === 2)
assert.equal(merged.title, '高数网课 · 第 1-2 节')
assert.equal(merged.duration, 180)
tasks = tasks.map(t => t.id === merged.id ? { ...t, start: '2026-10-15T02:12:00.000Z', status: 'completed', completedAt: '2026-10-15T05:12:00.000Z' } : t)
assert.equal(planStats(tasks, plan).scheduled, 2)
assert.equal(planStats(tasks, plan).completed, 2)
assert.equal(planStats(tasks, plan).waiting, 8)
assert.throws(() => mergePlanParts(tasks, plan.id, new Set([merged.id, children[2].id])))
assert.throws(() => splitPlan([plan], plan.id, 0))
assert.throws(() => splitPlan([plan], plan.id, 9)) // 810 minute block
const expanded = tasks.map(t => t.id === plan.id ? { ...t, planDefinition: { ...definition, totalUnits: 12 } } : t)
assert.deepEqual(planChildren(splitPlan(expanded, plan.id, 2), plan.id).at(-1).planAllocation.units, [11,12])
const restored = parseBackupText(JSON.stringify(createBackup(tasks))).tasks
assert.deepEqual(restored, JSON.parse(JSON.stringify(tasks)))
assert.equal(planImport(restored, createBackup(restored)).added, 0)
const altered = tasks.map(t => t.id === merged.id ? { ...t, duration: 175 } : t)
const imported = planImport(altered, createBackup(restored))
assert.equal(imported.mergedTasks.filter(t => t.planDefinition).length, 2)
const copiedPlan = imported.mergedTasks.find(t => t.planDefinition && t.id !== plan.id)
assert.equal(planChildren(imported.mergedTasks, copiedPlan.id).length, 9)
assert.doesNotThrow(() => validateTaskList(imported.mergedTasks))
const collidingOrdinary = { ...ordinary, id: children[0].id }
const overlapImport = planImport([collidingOrdinary], createBackup(restored))
assert.doesNotThrow(() => validateTaskList(overlapImport.mergedTasks))
assert.equal(planChildren(overlapImport.mergedTasks, overlapImport.mergedTasks.find(t => t.planDefinition).id).length, 9)
assert.equal(planChildren(imported.mergedTasks, plan.id).find(t => t.id === merged.id).duration, 175)
assert.doesNotThrow(() => validateTaskList(removePlan(tasks, plan.id)))
assert.equal(removePlan(tasks, plan.id).length, tasks.length - 1)
assert.equal(removePlan(tasks, plan.id).some(t => t.planAllocation), false)
assert.throws(() => validateTaskList(tasks.filter(t => t.id !== plan.id)))
assert.throws(() => validateTaskList([...tasks, { ...children[2], id: 'duplicate-unit' }]))
assert.throws(() => validateTaskList([plan, {...children[0], planAllocation:{ planId:plan.id, units:[11] }}]))
assert.throws(() => validateTaskList([{ ...plan, start: '2026-10-15T02:00:00.000Z' }]))
assert.throws(() => validateTaskList([{ ...plan, planDefinition: { ...definition, totalUnits: 501 } }]))
assert.throws(() => validateTaskList([{ ...plan, planDefinition: { ...definition, deadline: 'bad' } }]))
const cloud = parseCloudSnapshot({ tasks, revision: 3, updated_at: '2026-10-15T02:00:00.000Z' })
assert.equal(cloudDataMatches(tasks, cloud.tasks), true)
assert.equal(classifyIncomingCloudSnapshot(tasks, taskFingerprint(tasks), altered), 'apply-cloud')
assert.equal(classifyIncomingCloudSnapshot(restoreLocalEdit(tasks), taskFingerprint(tasks), altered), 'conflict')
function restoreLocalEdit(items) { return items.map(t => t.id === plan.id ? { ...t, title:'本机计划' } : t) }
const ddl = createPlan('期中作业', 'orange', 60, { type:'deadline', totalUnits:0, unitLabel:'项', deadline:'2026-10-20T15:59:00.000Z', notes:'写初稿', reminderMinutes:1440 })
const { planDefinition: ignored, ...ddlWork } = createPlan('查资料', 'orange', 60, ddl.planDefinition)
assert.doesNotThrow(() => validateTaskList([ddl, { ...ddlWork, planAllocation:{planId:ddl.id, units:[]} }]))
assert.equal(duePlanReminders([ddl], new Date('2026-10-19T15:59:00.000Z')).length, 1)
assert.equal(duePlanReminders([{ ...ddl, remindedAt:'2026-10-19T15:59:00.000Z' }], new Date('2026-10-19T16:00:00.000Z')).length, 0)
assert.equal(duePlanReminders([{ ...ddl, status:'completed' }], new Date('2026-10-19T16:00:00.000Z')).length, 0)
assert.equal(deadlineLabel('2026-10-20T15:59:00.000Z', new Date('2026-10-21T00:00:00.000Z')), '已逾期')
assert.equal(durationFromTimes('2026-10-15T10:12', '2026-10-15T11:47'), 95)
assert.equal(durationFromTimes('2026-10-15T23:40', '2026-10-16T00:20'), 40)
assert.equal(durationFromTimes('2026-10-15T10:12', '2026-10-15T10:12'), null)
assert.equal(durationFromTimes('2026-10-15T10:12', '2026-10-15T10:11'), null)
assert.equal(durationFromTimes('bad', 'bad'), null)
assert.equal(endFromDuration('2026-10-15T10:12', '95'), '2026-10-15T11:47')
assert.equal(endFromDuration('2026-10-15T10:12', ''), '')
// Batch deletion preserves graph integrity, exact times, restore data, and unrelated records.
const deletedAt = '2026-10-18T04:00:00.000Z'
const oldDeletedAt = '2026-10-17T04:00:00.000Z'
const otherPlan = createPlan('保留的计划', 'green', 30, definition)
const deletionTasks = [...tasks, ddl, { ...ddlWork, planAllocation: { planId: ddl.id, units: [] } }, otherPlan, { ...children[0], id: 'old-trash', deletedAt: oldDeletedAt, planAllocation: { planId: otherPlan.id, units: [1] } }]
const beforeDeletion = JSON.stringify(deletionTasks)
const selection = new Set([plan.id, ordinary.id, 'missing-id'])
assert.deepEqual(batchDeleteSummary(deletionTasks, selection), { count: 2, plans: 1, schedules: 1, children: 9 })
assert.equal(deleteSelectedTasks(deletionTasks, new Set(['missing-id'])), deletionTasks)
const kept = deleteSelectedTasks(deletionTasks, selection, false, deletedAt)
assert.equal(kept.some(t => t.id === plan.id), false)
assert.equal(kept.find(t => t.id === ordinary.id).deletedAt, deletedAt)
assert.equal(kept.find(t => t.id === merged.id).start, '2026-10-15T02:12:00.000Z')
assert.equal(kept.find(t => t.id === merged.id).status, 'completed')
assert.equal(kept.find(t => t.id === merged.id).planAllocation, undefined)
assert.equal(kept.find(t => t.id === merged.id).deletedAt, null)
assert.equal(kept.find(t => t.id === ddl.id), ddl)
assert.doesNotThrow(() => validateTaskList(kept))
const both = deleteSelectedTasks(deletionTasks, new Set([plan.id, merged.id]), false, deletedAt)
assert.equal(both.find(t => t.id === merged.id).deletedAt, deletedAt)
assert.equal(both.filter(t => t.deletedAt === deletedAt).length, 1)
const all = deleteSelectedTasks(deletionTasks, new Set([plan.id, ddl.id, otherPlan.id]), true, deletedAt)
assert.equal(all.some(t => t.planDefinition || t.planAllocation), false)
assert.equal(all.find(t => t.id === ordinary.id), ordinary)
assert.equal(all.find(t => t.id === 'old-trash').deletedAt, oldDeletedAt)
assert.equal(all.filter(t => t.deletedAt === deletedAt).length, 10)
assert.doesNotThrow(() => validateTaskList(all))
assert.doesNotThrow(() => parseBackupText(JSON.stringify(createBackup(all))))
assert.doesNotThrow(() => parseCloudSnapshot({ tasks: all, revision: 4, updated_at: deletedAt }))
const justChild = deleteSelectedTasks(deletionTasks, new Set([merged.id]), false, deletedAt)
assert.deepEqual(justChild.find(t => t.id === merged.id), { ...deletionTasks.find(t => t.id === merged.id), deletedAt })
assert.equal(justChild.find(t => t.id === plan.id), plan)
assert.equal(planStats(justChild, plan).scheduled, 0)
assert.equal(planStats(justChild, plan).completed, 0)
assert.doesNotThrow(() => validateTaskList(justChild))
assert.doesNotThrow(() => validateTaskList(justChild.map(t => t.id === merged.id ? { ...t, deletedAt: null } : t)))
assert.equal(deleteSelectedTasks(justChild, new Set([merged.id])), justChild)
assert.equal(JSON.stringify(deletionTasks), beforeDeletion)
console.log('long-term plan, batch deletion, and time-input tests passed')

// Sorting changes only plan metadata, preserves legacy order, and survives JSONB reordering.
const sortingInput = [ordinary, plan, children[0], ddl, otherPlan]
const sortingOriginal = JSON.stringify(sortingInput)
assert.deepEqual(orderedPlans(sortingInput).map(t => t.id), [plan.id, ddl.id, otherPlan.id])
const sorted = reorderPlans(sortingInput, otherPlan.id, plan.id)
assert.deepEqual(orderedPlans(sorted).map(t => t.id), [otherPlan.id, plan.id, ddl.id])
assert.equal(sorted[0], ordinary)
assert.equal(sorted[2], children[0])
assert.equal(JSON.stringify(sortingInput), sortingOriginal)
assert.equal(reorderPlans(sorted, plan.id, plan.id), sorted)
assert.equal(reorderPlans(sorted, 'missing', plan.id), sorted)
for (const roundTrip of [parseBackupText(JSON.stringify(createBackup(sorted))).tasks, parseCloudSnapshot({tasks: sorted, revision: 5, updated_at: deletedAt}).tasks.reverse()]) {
  assert.deepEqual(orderedPlans(roundTrip).map(t => t.id), [otherPlan.id, plan.id, ddl.id])
}
assert.throws(() => validateTaskList([{...plan, planDefinition:{...definition, sortOrder: -1}}]))
assert.throws(() => validateTaskList([{...plan, planDefinition:{...definition, sortOrder: Infinity}}]))

// Quantity and deadline are independent; converting old deadline work never changes its schedule.
const work = {...ddlWork, start:'2026-10-18T02:12:00.000Z', status:'completed', completedAt:deletedAt, planAllocation:{planId:ddl.id, units:[]}}
const conversionInput = [ordinary, ddl, work]
const combinedDefinition = {...ddl.planDefinition, type:'countable', totalUnits: 3, unitLabel:'节', sortOrder:2}
const converted = updatePlanDefinition(conversionInput, ddl.id, combinedDefinition)
assert.deepEqual(converted[2], {...work, planAllocation:{planId:ddl.id, units:[1]}})
assert.equal(converted[1].planDefinition.deadline, ddl.planDefinition.deadline)
assert.equal(planStats(converted, converted[1]).completed, 1)
const splitConverted = splitPlan(converted, ddl.id, 1)
assert.equal(planChildren(splitConverted, ddl.id).length, 3)
assert.equal(splitConverted[0], ordinary)
assert.doesNotThrow(() => validateTaskList(splitConverted))
assert.equal(duePlanReminders(splitConverted, new Date('2026-10-19T15:59:00.000Z')).length, 1)
assert.throws(() => updatePlanDefinition(converted, ddl.id, {...combinedDefinition,totalUnits:0}))
assert.throws(() => updatePlanDefinition(converted, ddl.id, ddl.planDefinition))
assert.doesNotThrow(() => validateTaskList([{...ddl,planDefinition:{...ddl.planDefinition,deadline:null,reminderMinutes:null}}]))
assert.deepEqual(parseBackupText(JSON.stringify(createBackup(splitConverted))).tasks, JSON.parse(JSON.stringify(splitConverted)))
assert.equal(cloudDataMatches(splitConverted, parseCloudSnapshot({tasks:splitConverted,revision:6,updated_at:deletedAt}).tasks), true)
console.log('plan sorting, independent deadline/quantity, and legacy conversion tests passed')

const pendingInput = [ordinary, plan, ...children.slice().reverse(),
  {...ddl, status:'completed'}, {...ddlWork, id:'completed-parent-child'},
  {...children[0], id:'scheduled', start:'2026-10-15T02:12:00.000Z'},
  {...children[0], id:'done', status:'completed'},
  {...children[0], id:'deleted', deletedAt},
  {...children[0], id:'orphan', planAllocation:{planId:'missing-plan',units:[1]}}]
const pendingBefore = JSON.stringify(pendingInput)
const pendingGroups = pendingPlanGroups(pendingInput)
assert.equal(pendingGroups.length, 1)
assert.equal(pendingGroups[0].plan, plan)
assert.deepEqual(pendingGroups[0].parts, children)
assert.equal(JSON.stringify(pendingInput), pendingBefore)
assert.deepEqual(pendingPlanGroups(pendingInput.map(t => t.id === plan.id ? {...t, deletedAt} : t)), [])
console.log('pending lesson shortcuts preserve data and exclude scheduled, completed, deleted, and orphaned work')
