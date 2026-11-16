import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorageAdapter, DEFAULT_STORAGE_KEY } from '../src/storage.js';
import { validateData } from '../src/validator.js';
import {getDateFlags,setScheduledDate,previewRollover,applyRollover,previewRolloverUndo,
 applyRolloverUndo,createRolloverSession,softDeleteTask,restoreTrashTask,
 softDeleteCompleted,listTrash,cleanupCandidates,permanentlyDeleteTask,emptyTrash} from '../src/dates-trash.js';

const ISO = '2026-11-16T04:00:00.000Z';
const LATER = '2026-11-17T04:00:00.000Z';
const task=(id,grade,order,extra={})=>({
 id,title:id,body:'',grade,order,scheduledDate:null,scheduleRevision:0,dueDate:null,
 completed:false,completedDate:null,tags:[],deletedAt:null,createdAt:ISO,updatedAt:ISO,...extra
});
const data=(items=[])=>({schemaVersion:1,revision:0,items});
const sample=()=>data([
 task('a','A',0,{scheduledDate:'2026-11-15',dueDate:'2026-11-14'}),
 task('b','A',1,{scheduledDate:'2026-11-16',dueDate:'2026-11-16'}),
 task('c','A',2,{dueDate:'2026-11-14'}),
 task('d','B',0,{scheduledDate:'2026-11-18'}),
 task('completed','A',null,{completed:true,scheduledDate:'2026-11-15',completedDate:'2026-11-15'}),
 task('trashed','C',null,{deletedAt:ISO,scheduledDate:'2026-11-15'})
]);
const valid=d=>assert.deepEqual(validateData(d).errors,[]);
const find=(d,id)=>d.items.find(t=>t.id===id);
const gradeIds=(d,g)=>d.items.filter(t=>t.grade===g&&!t.completed&&t.deletedAt===null)
 .sort((a,b)=>a.order-b.order).map(t=>t.id);
class MemStorage {
 constructor(){this.map=new Map();this.fail=false;}
 getItem(k){return this.map.get(k)??null;}
 setItem(k,v){if(this.fail)throw new DOMException('full','QuotaExceededError');this.map.set(k,String(v));}
 get length(){return this.map.size;}
 key(i){return [...this.map.keys()][i]??null;}
}

test('local date flags distinguish scheduled today and due overdue',()=>{
 const d=sample();
 assert.deepEqual(getDateFlags(find(d,'a'),'2026-11-16'),{today:false,overdue:true});
 assert.deepEqual(getDateFlags(find(d,'b'),'2026-11-16'),{today:true,overdue:false});
 assert.deepEqual(getDateFlags(find(d,'completed'),'2026-11-16'),{today:false,overdue:false});
 assert.deepEqual(getDateFlags(find(d,'trashed'),'2026-11-16'),{today:false,overdue:false});
});
test('preview only targets active incomplete scheduled dates <= today',()=>{
 assert.deepEqual(previewRollover(sample(),'2026-11-16','2026-11-17').map(c=>c.taskId),['a','b']);
 assert.throws(()=>previewRollover(sample(),'2026-11-16','2026-11-16'));
});
test('rollover updates scheduled date and revisions without altering due date',()=>{
 const before=sample(),{data:after,changes}=applyRollover(before,'2026-11-16','2026-11-17',LATER);
 valid(after);assert.equal(changes.length,2);
 for(const id of ['a','b']){
  assert.equal(find(after,id).scheduledDate,'2026-11-17');
  assert.equal(find(after,id).scheduleRevision,1);
  assert.equal(find(after,id).dueDate,find(before,id).dueDate);
 }
 assert.deepEqual(before,sample());assert.equal(find(after,'c').scheduleRevision,0);
});
test('direct date edit increments only on actual change and accepts null',()=>{
 const d=sample();
 assert.strictEqual(setScheduledDate(d,'b','2026-11-16',LATER),d);
 const modified=setScheduledDate(d,'b',null,LATER);valid(modified);
 assert.equal(find(modified,'b').scheduleRevision,1);
 assert.throws(()=>setScheduledDate(d,'b','2026-02-30',LATER));
 assert.throws(()=>setScheduledDate(d,'trashed',null,LATER));
});
test('undo increments revision and restores only eligible items',()=>{
 const applied=applyRollover(sample(),'2026-11-16','2026-11-17',LATER);
 const record={action:'rollover',changes:applied.changes};
 const result=applyRolloverUndo(applied.data,record,ISO);
 valid(result.data);assert.equal(result.restored.length,2);
 assert.equal(find(result.data,'a').scheduledDate,'2026-11-15');
 assert.equal(find(result.data,'a').scheduleRevision,2);
});
test('undo allows title changes but detects different-and-back dates',()=>{
 const applied=applyRollover(sample(),'2026-11-16','2026-11-17',LATER);
 const record={action:'rollover',changes:applied.changes};
 const edited={...applied.data,items:applied.data.items.map(t=>t.id==='a'?{...t,title:'renamed'}:t)};
 assert.equal(previewRolloverUndo(edited,record).restored.length,2);
 const moved=setScheduledDate(setScheduledDate(edited,'a','2026-11-18',ISO),'a','2026-11-17',ISO);
 const result=applyRolloverUndo(moved,record,ISO);
 valid(result.data);assert.deepEqual(result.conflicts.map(x=>x.taskId),['a']);
 assert.deepEqual(result.restored.map(x=>x.taskId),['b']);
 assert.equal(find(result.data,'a').scheduledDate,'2026-11-17');
});
test('completed, deleted and missing tasks conflict on undo',()=>{
 const applied=applyRollover(sample(),'2026-11-16','2026-11-17',LATER);
 const changed=softDeleteTask(applied.data,'a',ISO);
 const result=previewRolloverUndo(changed,{action:'rollover',changes:applied.changes});
 assert.deepEqual(result.conflicts.map(x=>x.taskId),['a']);
 assert.deepEqual(result.restored.map(x=>x.taskId),['b']);
});
test('soft delete compacts active rank and retains task fields',()=>{
 const before=sample(),after=softDeleteTask(before,'b',ISO);
 valid(after);assert.deepEqual(gradeIds(after,'A'),['a','c']);
 assert.equal(find(after,'b').order,null);assert.equal(find(after,'b').deletedAt,ISO);
 assert.equal(find(after,'b').scheduledDate,find(before,'b').scheduledDate);
 assert.throws(()=>softDeleteTask(after,'b',ISO));
});
test('restore incomplete task appends; restore completed task keeps null order',()=>{
 const deleted=softDeleteTask(sample(),'a',ISO),restored=restoreTrashTask(deleted,'a',LATER);
 valid(restored);assert.deepEqual(gradeIds(restored,'A'),['b','c','a']);
 const completed=softDeleteTask(sample(),'completed',ISO);
 const completedRestore=restoreTrashTask(completed,'completed',LATER);
 valid(completedRestore);assert.equal(find(completedRestore,'completed').completed,true);
 assert.equal(find(completedRestore,'completed').order,null);
});
test('bulk clear completed moves to trash, not permanent delete',()=>{
 const {data:after,ids}=softDeleteCompleted(sample(),LATER);
 valid(after);assert.deepEqual(ids,['completed']);
 assert.equal(find(after,'completed').deletedAt,LATER);
 assert.equal(after.items.length,sample().items.length);
});
test('cleanup candidates mark 30-day cutoff and warning, never auto-delete',()=>{
 const old='2026-10-17T04:00:00.000Z';
 const d=data([task('a','A',null,{deletedAt:old}),task('b','A',null,{deletedAt:ISO})]);
 const result=cleanupCandidates(d,ISO,30,1);
 assert.deepEqual(result.candidates.map(t=>t.id),['a']);
 assert.equal(result.warning,true);assert.equal(d.items.length,2);
});
test('permanent delete requires confirmation and trash state',()=>{
 const d=sample();
 assert.throws(()=>permanentlyDeleteTask(d,'a',true));
 assert.throws(()=>permanentlyDeleteTask(d,'trashed',false));
 const cleaned=permanentlyDeleteTask(d,'trashed',true);
 valid(cleaned);assert.equal(find(cleaned,'trashed'),undefined);
 assert.equal(find(d,'trashed')!==undefined,true);
});
test('empty trash requires confirmation and keeps active tasks',()=>{
 const d=sample();assert.throws(()=>emptyTrash(d));
 const cleaned=emptyTrash(d,true);valid(cleaned);
 assert.equal(cleaned.items.length,d.items.length-1);
 assert.equal(find(cleaned,'a')!==undefined,true);
});
test('session records rollover only after successful adapter update',async()=>{
 const storage=new MemStorage(),adapter=createStorageAdapter(storage);
 storage.setItem(DEFAULT_STORAGE_KEY,JSON.stringify(sample()));
 const session=createRolloverSession(adapter);
 storage.fail=true;
 const failed=await session.rollover(0,'2026-11-16','2026-11-17',LATER);
 assert.equal(failed.ok,false);assert.equal(session.getRecord(),null);
 storage.fail=false;
 const applied=await session.rollover(0,'2026-11-16','2026-11-17',LATER);
 assert.equal(applied.ok,true);assert.equal(applied.revision,1);
 assert.equal(session.getRecord().changes.length,2);
 assert.equal((await session.undo(1,ISO,false)).reason,'confirmationRequired');
 const undone=await session.undo(1,ISO,true);
 assert.equal(undone.ok,true);assert.equal(undone.restored.length,2);
 assert.equal(session.getRecord(),null);valid(adapter.load().data);
});
test('session undo partial conflict restores in one saved transaction',async()=>{
 const storage=new MemStorage(),adapter=createStorageAdapter(storage);
 storage.setItem(DEFAULT_STORAGE_KEY,JSON.stringify(sample()));
 const session=createRolloverSession(adapter);
 await session.rollover(0,'2026-11-16','2026-11-17',LATER);
 await adapter.update(1,d=>softDeleteTask(d,'a',ISO));
 const undone=await session.undo(2,ISO,true);
 assert.equal(undone.ok,true);assert.equal(undone.restored.length,1);
 assert.deepEqual(undone.conflicts.map(c=>c.taskId),['a']);
 assert.equal(undone.revision,3);valid(undone.data);
});
test('session invalidate after import/restore removes stale undo',async()=>{
 const storage=new MemStorage(),adapter=createStorageAdapter(storage);
 storage.setItem(DEFAULT_STORAGE_KEY,JSON.stringify(sample()));
 const session=createRolloverSession(adapter);
 await session.rollover(0,'2026-11-16','2026-11-17',LATER);
 const backup=sample();
 const imported=await adapter.importBackup(backup,1,true);
 assert.equal(imported.ok,true);
 session.invalidate();
 assert.equal(session.getRecord(),null);
 assert.equal((await session.undo(2,ISO,true)).reason,'noUndo');
});
test('failed trash save preserves storage and original order',async()=>{
 const storage=new MemStorage(),adapter=createStorageAdapter(storage);
 storage.setItem(DEFAULT_STORAGE_KEY,JSON.stringify(sample()));
 const original=storage.getItem(DEFAULT_STORAGE_KEY);storage.fail=true;
 const result=await adapter.update(0,d=>softDeleteTask(d,'b',ISO));
 assert.equal(result.reason,'quotaExceeded');
 assert.equal(storage.getItem(DEFAULT_STORAGE_KEY),original);
});
test('single atomic delete and restore with validation',async()=>{
 const storage=new MemStorage(),adapter=createStorageAdapter(storage);
 storage.setItem(DEFAULT_STORAGE_KEY,JSON.stringify(sample()));
 const deleted=await adapter.update(0,d=>softDeleteTask(d,'b',ISO));
 assert.equal(deleted.revision,1);valid(deleted.data);
 const restored=await adapter.update(1,d=>restoreTrashTask(d,'b',LATER));
 assert.equal(restored.revision,2);valid(restored.data);
 assert.deepEqual(gradeIds(restored.data,'A'),['a','c','b']);
});
