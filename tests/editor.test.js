import test from 'node:test';
import assert from 'node:assert/strict';
import {createTask,editTask,normalizeTaskInput} from '../src/editor.js';
import {validateData} from '../src/validator.js';
import {createStorageAdapter, DEFAULT_STORAGE_KEY} from '../src/storage.js';
const NOW='2026-11-16T05:00:00.000Z';
const empty=()=>({schemaVersion:1,revision:0,items:[]});
const input=(overrides={})=>({title:' 업무 작성 ',body:'설명',grade:'A',scheduledDate:'2026-11-16',dueDate:'2026-11-20',tags:[' #보고 ','보고','검토'],...overrides});
const task=(id,grade,order,extra={})=>({id,title:id,body:'',grade,order,scheduledDate:null,scheduleRevision:0,dueDate:null,completed:false,completedDate:null,tags:[],deletedAt:null,createdAt:NOW,updatedAt:NOW,...extra});
test('create normalizes tags and dates and appends correct rank',()=>{
 const base=empty(),after=createTask(base,input(),{id:'one',isoNow:NOW});
 assert.deepEqual(base,empty());
 assert.equal(after.items[0].title,'업무 작성');
 assert.deepEqual(after.items[0].tags,['보고','검토']);
 assert.equal(after.items[0].scheduleRevision,0);
 assert.equal(validateData(after).valid,true);
});
test('new tasks are appended per grade excluding completed',()=>{
 const original={...empty(),items:[task('a','A',0),task('done','A',null,{completed:true})]};
 const next=createTask(original,input(),{id:'b',isoNow:NOW});
 assert.equal(next.items.find(t=>t.id==='b').order,1);
 assert.equal(validateData(next).valid,true);
});
test('invalid title, date, tag and duplicate id are rejected',()=>{
 for(const value of [input({title:'   '}),input({dueDate:'2026-02-30'}),input({tags:['#']})])
   assert.throws(()=>createTask(empty(),value,{id:'a',isoNow:NOW}));
 const base=createTask(empty(),input(),{id:'a',isoNow:NOW});
 assert.throws(()=>createTask(base,input(),{id:'a',isoNow:NOW}));
});
test('edit no-op returns original object unchanged',()=>{
 const base=createTask(empty(),input(),{id:'a',isoNow:NOW});
 assert.strictEqual(editTask(base,'a',input({title:'업무 작성',tags:['보고','검토']}),NOW),base);
});
test('edit scheduledDate increments scheduleRevision only on actual difference',()=>{
 const base=createTask(empty(),input(),{id:'a',isoNow:NOW});
 const updated=editTask(base,'a',input({scheduledDate:'2026-11-17'}),NOW);
 assert.equal(updated.items[0].scheduleRevision,1);
 const other=editTask(updated,'a',input({scheduledDate:'2026-11-17',title:'다른 이름'}),NOW);
 assert.equal(other.items[0].scheduleRevision,1);
 assert.equal(validateData(other).valid,true);
});
test('edit grade compacts source and appends target in one candidate',()=>{
 const base={...empty(),items:[task('a','A',0),task('b','A',1),task('c','B',0)]};
 const next=editTask(base,'b',input({grade:'B',scheduledDate:null,dueDate:null,tags:[]}),NOW);
 assert.deepEqual(next.items.filter(t=>t.grade==='A').map(t=>t.order),[0]);
 assert.equal(next.items.find(t=>t.id==='b').order,1);
 assert.equal(validateData(next).valid,true);
});
test('completed task edit keeps completed and order null',()=>{
 const base={...empty(),items:[task('done','C',null,{completed:true})]};
 const next=editTask(base,'done',input({grade:'A',scheduledDate:null,dueDate:null,tags:[]}),NOW);
 assert.equal(next.items[0].completed,true);assert.equal(next.items[0].order,null);
 assert.equal(validateData(next).valid,true);
});
test('storage adapter commits new task and refuses invalid candidate',async()=>{
 const mem=new Map();
 const storage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,String(v))};
 const adapter=createStorageAdapter(storage);
 const created=await adapter.update(0,d=>createTask(d,input(),{id:'a',isoNow:NOW}));
 assert.equal(created.ok,true);assert.equal(created.revision,1);
 const before=mem.get(DEFAULT_STORAGE_KEY);
 const failed=await adapter.update(1,d=>createTask(d,input({title:''}),{id:'b',isoNow:NOW}));
 assert.equal(failed.reason,'transformFailed');
 assert.equal(mem.get(DEFAULT_STORAGE_KEY),before);
});
