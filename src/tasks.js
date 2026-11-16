import { normalizeTagKey } from './validator.js';

// Phase 2: all changes are pure; the caller commits one candidate via adapter.update().
const GRADES = ['A', 'B', 'C'];
const active = t => t.deletedAt === null && t.completed === false;
const clone = x => structuredClone(x);
function requireThat(ok, message) { if (!ok) throw new Error(message); }
function gradeIds(data, grade) {
  return data.items.filter(t => active(t) && t.grade === grade)
    .sort((a,b) => a.order - b.order).map(t => t.id);
}
function applyOrders(next, grade, ids) {
  const index = new Map(ids.map((id,i)=>[id,i]));
  for (const t of next.items) if (active(t) && t.grade === grade) {
    requireThat(index.has(t.id), 'missing task in grade');
    t.order = index.get(t.id);
  }
}
export function reorderGrade(data, grade, orderedIds) {
  requireThat(GRADES.includes(grade), 'invalid grade');
  const current = gradeIds(data, grade);
  requireThat(Array.isArray(orderedIds) && orderedIds.length === current.length, 'incomplete grade order');
  requireThat(orderedIds.every(id=>typeof id==='string') &&
    new Set(orderedIds).size===orderedIds.length &&
    current.every(id=>orderedIds.includes(id)), 'duplicate or foreign grade ID');
  if (current.every((id,i)=>id===orderedIds[i])) return data;
  const next=clone(data);
  applyOrders(next,grade,orderedIds);
  return next;
}
export function moveWithinGrade(data, taskId, toIndex) {
  const task=data.items.find(t=>t.id===taskId);
  requireThat(task && active(task), 'task must be active and incomplete');
  const ids=gradeIds(data,task.grade);
  requireThat(Number.isSafeInteger(toIndex) && toIndex>=0 && toIndex<ids.length,'invalid target index');
  const from=ids.indexOf(taskId);
  requireThat(from!==-1,'task missing from grade');
  if(from===toIndex)return data;
  ids.splice(from,1);
  ids.splice(toIndex,0,taskId);
  return reorderGrade(data,task.grade,ids);
}
export function moveTask(data,taskId,toGrade,toIndex) {
  requireThat(GRADES.includes(toGrade),'invalid destination grade');
  const task=data.items.find(t=>t.id===taskId);
  requireThat(task && active(task),'task must be active and incomplete');
  if(task.grade===toGrade)return moveWithinGrade(data,taskId,toIndex);
  const fromIds=gradeIds(data,task.grade).filter(id=>id!==taskId);
  const toIds=gradeIds(data,toGrade);
  requireThat(Number.isSafeInteger(toIndex) && toIndex>=0 && toIndex<=toIds.length,'invalid target index');
  toIds.splice(toIndex,0,taskId);
  const next=clone(data);
  next.items.find(t=>t.id===taskId).grade=toGrade;
  applyOrders(next,task.grade,fromIds);
  applyOrders(next,toGrade,toIds);
  return next;
}
export function completeTask(data,taskId,completedDate,isoNow) {
  const task=data.items.find(t=>t.id===taskId);
  requireThat(task && active(task),'task must be active and incomplete');
  requireThat(typeof completedDate==='string' && typeof isoNow==='string','dates required');
  const next=clone(data), target=next.items.find(t=>t.id===taskId);
  target.completed=true;
  target.completedDate=completedDate;
  target.order=null;
  target.updatedAt=isoNow;
  applyOrders(next,task.grade,gradeIds(data,task.grade).filter(id=>id!==taskId));
  return next;
}
export function reopenTask(data,taskId,isoNow) {
  const task=data.items.find(t=>t.id===taskId);
  requireThat(task && task.deletedAt===null && task.completed===true,'task must be active and completed');
  requireThat(typeof isoNow==='string','updatedAt required');
  const next=clone(data), target=next.items.find(t=>t.id===taskId);
  target.completed=false;
  target.completedDate=null;
  target.order=gradeIds(data,task.grade).length;
  target.updatedAt=isoNow;
  return next;
}
export function normalizeTags(tags) {
  requireThat(Array.isArray(tags),'tags must be an array');
  const values=[], keys=new Set();
  for(const raw of tags) {
    requireThat(typeof raw==='string','tag must be text');
    const label=raw.trim().replace(/^#/,'').trim();
    requireThat(label.length>0 && label.length<=50,'invalid tag length');
    const key=normalizeTagKey(label);
    if(keys.has(key))continue;
    keys.add(key); values.push(label);
    requireThat(values.length<=20,'too many tags');
  }
  return values;
}
export function getTagOptions(data) {
  const result=new Map();
  const tasks=data.items.filter(t=>t.deletedAt===null)
    .sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  for(const task of tasks)for(const label of task.tags) {
    const key=normalizeTagKey(label);
    if(key&&!result.has(key))result.set(key,{key,label});
  }
  return [...result.values()].sort((a,b)=>a.label.localeCompare(b.label));
}
export function pruneSelectedTags(data,selectedTags) {
  const valid=new Set(getTagOptions(data).map(t=>t.key));
  return [...new Set(selectedTags.map(normalizeTagKey))].filter(key=>valid.has(key));
}
export function filterTasks(data,{
  selectedTags=[],tagMode='AND',search='',grade=null,showCompleted=false
}={}) {
  requireThat(tagMode==='AND'||tagMode==='OR','invalid tag mode');
  requireThat(grade===null||GRADES.includes(grade),'invalid grade');
  const keys=[...new Set(selectedTags.map(normalizeTagKey))];
  const query=String(search).trim().toLocaleLowerCase('en-US');
  return data.items.filter(task=>{
    if(task.deletedAt!==null||task.completed!==Boolean(showCompleted))return false;
    if(grade!==null&&task.grade!==grade)return false;
    const taskKeys=new Set(task.tags.map(normalizeTagKey));
    if(keys.length&&!(tagMode==='AND'?
      keys.every(key=>taskKeys.has(key)):keys.some(key=>taskKeys.has(key))))return false;
    if(query&&![task.title,task.body,...task.tags].some(s=>s.toLocaleLowerCase('en-US').includes(query)))return false;
    return true;
  }).sort((a,b)=>GRADES.indexOf(a.grade)-GRADES.indexOf(b.grade)||
    (showCompleted?a.createdAt.localeCompare(b.createdAt):a.order-b.order)||
    a.id.localeCompare(b.id));
}
export function hasActiveFilter({selectedTags=[],search='',grade=null}={}) {
  return selectedTags.length>0||String(search).trim().length>0||grade!==null;
}
export function canDrag(filters={}) {return !hasActiveFilter(filters);}
