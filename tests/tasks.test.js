import test from 'node:test';
import assert from 'node:assert/strict';
import {validateData} from '../src/validator.js';
import {reorderGrade,moveTask,moveWithinGrade,completeTask,reopenTask,normalizeTags,
getTagOptions,pruneSelectedTags,filterTasks,hasActiveFilter,canDrag} from '../src/tasks.js';
import {createStorageAdapter,DEFAULT_STORAGE_KEY} from '../src/storage.js';

const NOW='2026-11-16T04:00:00.000Z',TODAY='2026-11-16';
const task=(id,grade,order,extra={})=>({
  id,title:id,body:'',grade,order,scheduledDate:null,scheduleRevision:0,
  dueDate:null,completed:false,completedDate:null,tags:[],deletedAt:null,
  createdAt:NOW,updatedAt:NOW,...extra
});
const data=(items=[])=>({schemaVersion:1,revision:0,items});
const base=()=>data([task('a','A',0),task('b','A',1),task('c','A',2),
  task('x','B',0),task('y','B',1)]);
const ids=(d,grade)=>d.items.filter(t=>t.grade===grade&&!t.completed&&t.deletedAt===null)
  .sort((a,b)=>a.order-b.order).map(t=>t.id);
const valid=d=>assert.equal(validateData(d).valid,true,JSON.stringify(validateData(d).errors));
class MemoryStorage{
  constructor(){this.map=new Map();this.fail=false;}
  getItem(key){return this.map.get(key)??null;}
  setItem(key,value){if(this.fail)throw new DOMException('full','QuotaExceededError');this.map.set(key,String(value));}
  get length(){return this.map.size;}
  key(index){return [...this.map.keys()][index]??null;}
}

test('reorder A is pure, compact and keeps B unchanged',()=>{
 const original=base(), snapshot=structuredClone(original), next=reorderGrade(original,'A',['c','a','b']);
 valid(next);assert.deepEqual(ids(next,'A'),['c','a','b']);assert.deepEqual(ids(next,'B'),['x','y']);
 assert.deepEqual(original,snapshot);
});
test('reorder requires every active ID exactly once',()=>{
 const d=base();
 for(const list of [['a','b'],['a','b','b'],['a','b','x']])
   assert.throws(()=>reorderGrade(d,'A',list));
});
test('reorder and same-index move are no-ops',()=>{
 const d=base();assert.strictEqual(reorderGrade(d,'A',['a','b','c']),d);
 assert.strictEqual(moveWithinGrade(d,'a',0),d);
});
test('numeric input/arrow movement uses grade reorder',()=>{
 const next=moveWithinGrade(base(),'a',2);
 valid(next);assert.deepEqual(ids(next,'A'),['b','c','a']);
});
test('cross-grade move compacts both grades in one candidate',()=>{
 const next=moveTask(base(),'b','B',1);
 valid(next);assert.deepEqual(ids(next,'A'),['a','c']);assert.deepEqual(ids(next,'B'),['x','b','y']);
});
test('moving to empty grade starts at zero',()=>{
 const next=moveTask(base(),'b','C',0);
 valid(next);assert.deepEqual(ids(next,'C'),['b']);assert.deepEqual(ids(next,'A'),['a','c']);
});
test('invalid target or completed item cannot move',()=>{
 const original=base(), snapshot=structuredClone(original);
 assert.throws(()=>moveTask(original,'a','B',9));
 assert.throws(()=>moveWithinGrade(original,'a',-1));
 const completed=completeTask(original,'a',TODAY,NOW);
 assert.throws(()=>moveTask(completed,'a','B',0));
 assert.deepEqual(original,snapshot);
});
test('completion nulls order and compacts incomplete ranks',()=>{
 const next=completeTask(base(),'b',TODAY,NOW);
 valid(next);assert.deepEqual(ids(next,'A'),['a','c']);
 const item=next.items.find(t=>t.id==='b');
 assert.equal(item.order,null);assert.equal(item.completed,true);assert.equal(item.completedDate,TODAY);
});
test('reopen clears completedDate and appends to grade',()=>{
 const next=reopenTask(completeTask(base(),'b',TODAY,NOW),'b',NOW);
 valid(next);assert.deepEqual(ids(next,'A'),['a','c','b']);
 assert.equal(next.items.find(t=>t.id==='b').completedDate,null);
});
test('reopen incomplete/trashed or double-complete blocked',()=>{
 assert.throws(()=>reopenTask(base(),'b',NOW));
 const next=completeTask(base(),'b',TODAY,NOW);
 assert.throws(()=>completeTask(next,'b',TODAY,NOW));
 assert.throws(()=>reopenTask(data([task('d','C',null,{completed:true,deletedAt:NOW})]),'d',NOW));
});
test('tag trim/# removal/dedup preserves original display',()=>{
 assert.deepEqual(normalizeTags([' #EMR ','emr',' 정책 ','#정책']),['EMR','정책']);
 assert.throws(()=>normalizeTags(['#']));
 assert.throws(()=>normalizeTags(Array.from({length:21},(_,i)=>String(i))));
});
test('completed tags count, deleted tags excluded',()=>{
 const d=data([
 task('b','B',0,{tags:['emr'],createdAt:'2026-11-16T05:00:00.000Z'}),
 task('a','A',null,{tags:['EMR'],completed:true,createdAt:'2026-11-16T03:00:00.000Z'}),
 task('c','C',null,{tags:['NEVER'],deletedAt:NOW})
 ]);
 assert.deepEqual(getTagOptions(d),[{key:'emr',label:'EMR'}]);
 assert.deepEqual(pruneSelectedTags(d,['EMR','NEVER']),['emr']);
});
test('representative tag uses oldest createdAt then smallest ID',()=>{
 const d=data([task('z','B',0,{tags:['emr']}),task('a','A',0,{tags:['EMR']})]);
 assert.deepEqual(getTagOptions(d),[{key:'emr',label:'EMR'}]);
});
test('AND/OR tag search, grade, completed and trash filters',()=>{
 const d=data([
 task('a','A',0,{title:'검토 보고',body:'법령 확인',tags:['EMR','정책']}),
 task('b','B',0,{title:'회의',tags:['emr']}),
 task('c','C',null,{title:'완료',completed:true,tags:['EMR']}),
 task('trash','C',null,{deletedAt:NOW,tags:['EMR']})
 ]);
 assert.deepEqual(filterTasks(d,{selectedTags:['EMR','정책']}).map(t=>t.id),['a']);
 assert.deepEqual(filterTasks(d,{selectedTags:['EMR','정책'],tagMode:'OR'}).map(t=>t.id),['a','b']);
 assert.deepEqual(filterTasks(d,{search:'법령'}).map(t=>t.id),['a']);
 assert.deepEqual(filterTasks(d,{search:'회의',grade:'B'}).map(t=>t.id),['b']);
 assert.deepEqual(filterTasks(d,{showCompleted:true}).map(t=>t.id),['c']);
});
test('active filter disables dragging, clear-all indicator remains',()=>{
 assert.equal(canDrag({}),true);
 assert.equal(canDrag({selectedTags:['emr']}),false);
 assert.equal(canDrag({search:'abc'}),false);
 assert.equal(canDrag({grade:'A'}),false);
 assert.equal(hasActiveFilter({search:'abc'}),true);
});
test('one storage update commits both grade changes together',async()=>{
 const storage=new MemoryStorage(),adapter=createStorageAdapter(storage);
 const initial=base();storage.setItem(DEFAULT_STORAGE_KEY,JSON.stringify(initial));
 const result=await adapter.update(0,current=>moveTask(current,'b','B',0));
 assert.equal(result.ok,true);assert.equal(result.revision,1);valid(result.data);
 assert.deepEqual(ids(result.data,'A'),['a','c']);
 assert.deepEqual(ids(result.data,'B'),['b','x','y']);
});
test('storage failure leaves both grades unchanged',async()=>{
 const storage=new MemoryStorage(),adapter=createStorageAdapter(storage);
 const initial=base();storage.setItem(DEFAULT_STORAGE_KEY,JSON.stringify(initial));
 const before=storage.getItem(DEFAULT_STORAGE_KEY);storage.fail=true;
 const result=await adapter.update(0,current=>completeTask(current,'b',TODAY,NOW));
 assert.deepEqual(result,{ok:false,reason:'quotaExceeded'});
 assert.equal(storage.getItem(DEFAULT_STORAGE_KEY),before);
});
test('invalid change after grade move is rejected atomically',async()=>{
 const storage=new MemoryStorage(),adapter=createStorageAdapter(storage);
 storage.setItem(DEFAULT_STORAGE_KEY,JSON.stringify(base()));
 const before=storage.getItem(DEFAULT_STORAGE_KEY);
 const result=await adapter.update(0,current=>{
   const next=moveTask(current,'b','B',0);
   return {...next,items:[...next.items,{...next.items[0],id:'a'}]};
 });
 assert.equal(result.reason,'validationFailed');
 assert.equal(storage.getItem(DEFAULT_STORAGE_KEY),before);
});
