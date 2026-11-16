/** Franklin planner schema v1; rejects malformed data instead of repairing it. */
export const SCHEMA_VERSION = 1;
const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonnegativeSafe = x => Number.isSafeInteger(x) && x >= 0;

export function isValidLocalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isUtcTimestamp(value) {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function normalizeTagKey(tag) {
  return tag.trim().replace(/^#/, '').trim().toLocaleLowerCase('en-US');
}

export function validateData(data) {
  const errors = [];
  const fail = (path, reason) => errors.push(path + ': ' + reason);
  if (!isRecord(data)) return { valid: false, errors: ['root: expected object'] };
  if (data.schemaVersion !== SCHEMA_VERSION) fail('schemaVersion', 'unsupported or missing');
  if (!nonnegativeSafe(data.revision)) fail('revision', 'expected nonnegative safe integer');
  if (!Array.isArray(data.items)) return { valid: false, errors: [...errors, 'items: expected array'] };
  const ids = new Set();
  const ordersByGrade = new Map(['A','B','C'].map(grade => [grade, []]));
  data.items.forEach((task, index) => {
    const path = 'items[' + index + ']';
    if (!isRecord(task)) { fail(path, 'expected object'); return; }
    if (typeof task.id !== 'string' || !task.id.trim()) fail(path + '.id', 'required ID');
    else if (ids.has(task.id)) fail(path + '.id', 'duplicate ID');
    else ids.add(task.id);
    if (typeof task.title !== 'string' || !task.title.trim() || task.title.length > 200) fail(path + '.title', 'required 1..200');
    if (typeof task.body !== 'string' || task.body.length > 20000) fail(path + '.body', 'expected string <= 20000');
    if (!['A','B','C'].includes(task.grade)) fail(path + '.grade', 'invalid grade');
    if (typeof task.completed !== 'boolean') fail(path + '.completed', 'expected boolean');
    if (!nonnegativeSafe(task.scheduleRevision)) fail(path + '.scheduleRevision', 'expected nonnegative safe integer');
    for (const field of ['scheduledDate','dueDate','completedDate']) {
      if (task[field] !== null && !isValidLocalDate(task[field])) fail(path + '.' + field, 'invalid calendar date');
    }
    for (const field of ['createdAt','updatedAt']) {
      if (!isUtcTimestamp(task[field])) fail(path + '.' + field, 'invalid UTC timestamp');
    }
    if (task.deletedAt !== null && !isUtcTimestamp(task.deletedAt)) fail(path + '.deletedAt', 'invalid UTC timestamp');
    if (!Array.isArray(task.tags) || task.tags.length > 20) fail(path + '.tags', 'expected array <= 20');
    else {
      const seen = new Set();
      task.tags.forEach((tag, tagIndex) => {
        if (typeof tag !== 'string' || !tag.trim() || tag.length > 50 ||
            tag !== tag.trim() || /^#/.test(tag)) {
          fail(path + '.tags[' + tagIndex + ']', 'invalid stored tag');
          return;
        }
        const key = normalizeTagKey(tag);
        if (!key || seen.has(key)) fail(path + '.tags[' + tagIndex + ']', 'duplicate/empty normalized tag');
        seen.add(key);
      });
    }
    const activeIncomplete = task.deletedAt === null && task.completed === false;
    if (activeIncomplete) {
      if (!nonnegativeSafe(task.order)) fail(path + '.order', 'active incomplete task needs order');
      else if (ordersByGrade.has(task.grade)) ordersByGrade.get(task.grade).push(task.order);
    } else if (task.order !== null) fail(path + '.order', 'completed/deleted task requires null');
    if (task.completed === false && task.completedDate !== null) fail(path + '.completedDate', 'incomplete task requires null');
  });
  for (const [grade, orders] of ordersByGrade) {
    orders.sort((a,b) => a-b);
    for (let i=0; i<orders.length; i++) if (orders[i] !== i) { fail('order.' + grade, 'expected consecutive 0..N-1'); break; }
  }
  return { valid: errors.length === 0, errors };
}

export function classifyRaw(raw) {
  if (raw === null) return { status: 'missing', data: { schemaVersion: 1, revision: 0, items: [] } };
  let data;
  try { data = JSON.parse(raw); } catch { return { status: 'corrupt' }; }
  if (isRecord(data) && Number.isSafeInteger(data.schemaVersion) && data.schemaVersion > 1) return { status: 'unsupportedVersion' };
  const validation = validateData(data);
  if (!validation.valid) return { status: 'corrupt', errors: validation.errors };
  return { status: data.items.length === 0 ? 'empty' : 'ok', data };
}
