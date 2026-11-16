import { isValidLocalDate, isUtcTimestamp } from './validator.js';

// Phase 3: pure transformations; the caller persists with exactly one adapter.update().
const clone = value => structuredClone(value);
const activeIncomplete = task => task.deletedAt === null && task.completed === false;
const requireValid = (ok, message) => { if (!ok) throw new Error(message); };
const requireDate = (date, label) => requireValid(isValidLocalDate(date), 'invalid ' + label);
const requireTimestamp = timestamp => requireValid(isUtcTimestamp(timestamp), 'invalid UTC timestamp');
const find = (data, id) => {
  const item = data.items.find(task => task.id === id);
  requireValid(item !== undefined, 'unknown task');
  return item;
};
const sortedGrade = (data, grade, excludingId = null) => data.items
  .filter(task => activeIncomplete(task) && task.grade === grade && task.id !== excludingId)
  .sort((a, b) => a.order - b.order);
function compactGrade(next, grade) {
  sortedGrade(next, grade).forEach((task, index) => { task.order = index; });
}
function changedSchedule(task, date, isoNow) {
  if (task.scheduledDate === date) return false;
  requireValid(Number.isSafeInteger(task.scheduleRevision) &&
    task.scheduleRevision < Number.MAX_SAFE_INTEGER, 'schedule revision overflow');
  task.scheduledDate = date;
  task.scheduleRevision += 1;
  task.updatedAt = isoNow;
  return true;
}

export function getDateFlags(task, localToday) {
  requireDate(localToday, 'today');
  const eligible = activeIncomplete(task);
  return {
    today: eligible && task.scheduledDate === localToday,
    overdue: eligible && task.dueDate !== null && task.dueDate < localToday
  };
}

export function setScheduledDate(data, taskId, date, isoNow) {
  requireValid(date === null || isValidLocalDate(date), 'invalid scheduled date');
  requireTimestamp(isoNow);
  const task = find(data, taskId);
  requireValid(task.deletedAt === null, 'cannot edit trash');
  if (task.scheduledDate === date) return data;
  const next = clone(data);
  changedSchedule(find(next, taskId), date, isoNow);
  return next;
}

// targetDate is explicitly chosen; no local-time/UTC conversion occurs here.
export function previewRollover(data, localToday, targetDate) {
  requireDate(localToday, 'today');
  requireDate(targetDate, 'target date');
  requireValid(targetDate > localToday, 'target date must be after today');
  return data.items.filter(task => activeIncomplete(task) &&
    task.scheduledDate !== null && task.scheduledDate <= localToday)
    .map(task => ({ taskId: task.id, before: task.scheduledDate,
      after: targetDate, scheduleRevisionAfter: task.scheduleRevision + 1 }));
}

export function applyRollover(data, localToday, targetDate, isoNow) {
  requireTimestamp(isoNow);
  const changes = previewRollover(data, localToday, targetDate);
  if (changes.length === 0) return { data, changes: [] };
  const next = clone(data);
  for (const change of changes) {
    const task = find(next, change.taskId);
    changedSchedule(task, targetDate, isoNow);
  }
  return { data: next, changes };
}

export function previewRolloverUndo(data, record) {
  requireValid(record?.action === 'rollover' && Array.isArray(record.changes), 'invalid rollover record');
  const restored = [], conflicts = [];
  for (const change of record.changes) {
    const task = data.items.find(item => item.id === change.taskId);
    const matches = task && activeIncomplete(task) &&
      task.scheduledDate === change.after &&
      task.scheduleRevision === change.scheduleRevisionAfter;
    if (matches) restored.push(change);
    else conflicts.push({ ...change, reason: !task ? 'missing' :
      !activeIncomplete(task) ? 'inactive' : 'scheduleChanged' });
  }
  return { restored, conflicts };
}

export function applyRolloverUndo(data, record, isoNow) {
  requireTimestamp(isoNow);
  const { restored, conflicts } = previewRolloverUndo(data, record);
  if (restored.length === 0) return { data, restored, conflicts };
  const next = clone(data);
  for (const change of restored) changedSchedule(find(next, change.taskId), change.before, isoNow);
  return { data: next, restored, conflicts };
}

// The controller only records a rollover after a successful storage commit.
// Call invalidate() after importBackup(), restore() or reset() succeeds; UI integration is phase 4.
export function createRolloverSession(adapter) {
  let last = null;
  const invalidate = () => { last = null; };
  return {
    getRecord: () => last === null ? null : clone(last),
    invalidate,
    preview: (data, today, target) => previewRollover(data, today, target),
    previewUndo: data => last ? previewRolloverUndo(data, last) : null,
    async rollover(expectedRevision, today, target, isoNow) {
      const loaded = adapter.load();
      if (!['ok', 'empty', 'missing'].includes(loaded.status)) return { ok: false, reason: loaded.status };
      const planned = previewRollover(loaded.data, today, target);
      if (planned.length === 0) return { ok: true, unchanged: true, changes: [], revision: loaded.data.revision, data: loaded.data };
      let changes = [];
      const result = await adapter.update(expectedRevision, data => {
        const applied = applyRollover(data, today, target, isoNow);
        changes = applied.changes;
        return applied.data;
      });
      if (result.ok && changes.length > 0) last = { action: 'rollover', changes: clone(changes) };
      return { ...result, changes: result.ok ? changes : [] };
    },
    async undo(expectedRevision, isoNow, confirmed = false) {
      if (!last) return { ok: false, reason: 'noUndo' };
      if (!confirmed) return { ok: false, reason: 'confirmationRequired' };
      const record = clone(last);
      const loaded = adapter.load();
      if (!['ok', 'empty', 'missing'].includes(loaded.status)) return { ok: false, reason: loaded.status };
      const planned = previewRolloverUndo(loaded.data, record);
      if (planned.restored.length === 0) return { ok: false, reason: 'allConflicted', conflicts: planned.conflicts };
      let applied;
      const result = await adapter.update(expectedRevision, data => {
        applied = applyRolloverUndo(data, record, isoNow);
        return applied.data;
      });
      if (result.ok) invalidate();
      return { ...result, restored: result.ok ? applied.restored : [],
        conflicts: result.ok ? applied.conflicts : [] };
    }
  };
}

export function softDeleteTask(data, taskId, isoNow) {
  requireTimestamp(isoNow);
  const task = find(data, taskId);
  requireValid(task.deletedAt === null, 'task already trashed');
  const next = clone(data);
  const target = find(next, taskId);
  target.deletedAt = isoNow;
  target.order = null;
  target.updatedAt = isoNow;
  if (!task.completed) compactGrade(next, task.grade);
  return next;
}

export function restoreTrashTask(data, taskId, isoNow) {
  requireTimestamp(isoNow);
  const task = find(data, taskId);
  requireValid(task.deletedAt !== null, 'task is not in trash');
  const next = clone(data);
  const target = find(next, taskId);
  target.deletedAt = null;
  target.order = task.completed ? null : sortedGrade(data, task.grade).length;
  target.updatedAt = isoNow;
  return next;
}

export function softDeleteCompleted(data, isoNow) {
  requireTimestamp(isoNow);
  const ids = data.items.filter(task => task.deletedAt === null && task.completed).map(task => task.id);
  if (ids.length === 0) return { data, ids };
  const next = clone(data);
  for (const task of next.items) if (ids.includes(task.id)) {
    task.deletedAt = isoNow;
    task.order = null;
    task.updatedAt = isoNow;
  }
  return { data: next, ids };
}

export function listTrash(data) { return data.items.filter(task => task.deletedAt !== null); }
export function cleanupCandidates(data, isoNow, days = 30, warningCount = 50) {
  requireTimestamp(isoNow);
  requireValid(Number.isSafeInteger(days) && days >= 0 &&
    Number.isSafeInteger(warningCount) && warningCount >= 1, 'invalid cleanup policy');
  const cutoff = Date.parse(isoNow) - days * 86400000;
  const candidates = listTrash(data).filter(task => Date.parse(task.deletedAt) <= cutoff);
  return { candidates, count: candidates.length, warning: candidates.length >= warningCount };
}

export function permanentlyDeleteTask(data, taskId, confirmed = false) {
  requireValid(confirmed, 'confirmation required');
  const task = find(data, taskId);
  requireValid(task.deletedAt !== null, 'must move task to trash first');
  const next = clone(data);
  next.items = next.items.filter(item => item.id !== taskId);
  return next;
}

export function emptyTrash(data, confirmed = false) {
  requireValid(confirmed, 'confirmation required');
  if (!data.items.some(task => task.deletedAt !== null)) return data;
  const next = clone(data);
  next.items = next.items.filter(task => task.deletedAt === null);
  return next;
}
