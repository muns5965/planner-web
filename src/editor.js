import { isValidLocalDate, isUtcTimestamp } from './validator.js';
import { normalizeTags } from './tasks.js';

const gradeAllowed = grade => ['A','B','C'].includes(grade);
const copy = value => structuredClone(value);
const fail = reason => { throw new Error(reason); };
const active = item => item.deletedAt === null && !item.completed;
const gradeTasks = (data, grade, omitId = null) => data.items
  .filter(item => active(item) && item.grade === grade && item.id !== omitId)
  .sort((a,b) => a.order - b.order);

export function normalizeTaskInput(input) {
  if (!input || typeof input !== 'object') fail('missing input');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 200) fail('title must contain 1–200 characters');
  const body = typeof input.body === 'string' ? input.body : '';
  if (body.length > 20000) fail('body exceeds 20000 characters');
  if (!gradeAllowed(input.grade)) fail('invalid grade');
  const scheduledDate = input.scheduledDate || null;
  const dueDate = input.dueDate || null;
  if (scheduledDate !== null && !isValidLocalDate(scheduledDate)) fail('invalid scheduled date');
  if (dueDate !== null && !isValidLocalDate(dueDate)) fail('invalid due date');
  const tags = normalizeTags(input.tags ?? []);
  return { title, body, grade:input.grade, scheduledDate, dueDate, tags };
}

export function createTask(data, input, { id, isoNow } = {}) {
  const values = normalizeTaskInput(input);
  if (typeof id !== 'string' || !id.trim() || data.items.some(item => item.id === id)) fail('duplicate or missing id');
  if (!isUtcTimestamp(isoNow)) fail('invalid UTC timestamp');
  const next = copy(data);
  next.items.push({
    id, ...values, order:gradeTasks(data,values.grade).length, scheduleRevision:0,
    completed:false, completedDate:null, deletedAt:null, createdAt:isoNow, updatedAt:isoNow
  });
  return next;
}

export function editTask(data, taskId, input, isoNow) {
  const values = normalizeTaskInput(input);
  if (!isUtcTimestamp(isoNow)) fail('invalid UTC timestamp');
  const original = data.items.find(task => task.id === taskId);
  if (!original || original.deletedAt !== null) fail('cannot edit deleted or missing task');
  const same = Object.entries(values).every(([key,value]) =>
    key === 'tags' ? JSON.stringify(value) === JSON.stringify(original.tags) : value === original[key]);
  if (same) return data;
  if (original.scheduledDate !== values.scheduledDate &&
      original.scheduleRevision >= Number.MAX_SAFE_INTEGER) fail('scheduleRevision overflow');
  const next = copy(data);
  const task = next.items.find(item => item.id === taskId);
  if (original.grade !== values.grade && !original.completed) {
    for (const [i,other] of gradeTasks(next, original.grade, taskId).entries()) {
      other.order = i;
    }
    task.order = gradeTasks(next, values.grade).length;
  }
  for (const [key,value] of Object.entries(values)) task[key] = value;
  if (original.scheduledDate !== values.scheduledDate) task.scheduleRevision++;
  task.updatedAt = isoNow;
  return next;
}
