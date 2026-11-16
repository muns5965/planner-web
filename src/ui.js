import { createStorageAdapter, DEFAULT_STORAGE_KEY } from './storage.js';
import { createTask, editTask } from './editor.js';
import { completeTask, reopenTask, moveTask, moveWithinGrade,
  filterTasks, getTagOptions, pruneSelectedTags, hasActiveFilter } from './tasks.js';
import { getDateFlags, previewRollover, createRolloverSession, softDeleteTask,
  restoreTrashTask, softDeleteCompleted, permanentlyDeleteTask, emptyTrash,
  listTrash, cleanupCandidates } from './dates-trash.js';
import { validateData } from './validator.js';

const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const grades = [{grade:'A',label:'매우 중요',sub:'핵심 목표와 최우선 과제'},
  {grade:'B',label:'중요',sub:'중요하고 계획적인 업무'},
  {grade:'C',label:'사소',sub:'일상 및 부수 업무'}];
const EMPTY={schemaVersion:1,revision:0,items:[]};
const goodStatus = new Set(['missing','empty','ok']);
const state = {data:EMPTY,status:'missing',view:'active',completionMode:false,search:'',
  grade:null,selectedTags:[],tagMode:'AND',externalDirty:false,busy:false,dragId:null};
let adapter;
try {
  const store=window.localStorage;
  const lock = navigator.locks?.request?.bind(navigator.locks);
  adapter=createStorageAdapter(store,{lock:lock?
    work => lock('franklin-planner-data-lock',{mode:'exclusive'},work) : work => work()});
} catch {
  adapter=createStorageAdapter({getItem(){throw new DOMException('blocked','SecurityError');}});
}
const rollover=createRolloverSession(adapter);

function localDate(date=new Date()){
  return [String(date.getFullYear()).padStart(4,'0'),
    String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
function nextLocalDate(){
  const d=new Date();d.setDate(d.getDate()+1);return localDate(d);
}
function toast(message,error=false){
  const box=byId('toast');box.textContent=message;box.hidden=false;
  box.classList.toggle('error',error);
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>{box.hidden=true;},5000);
}
const countActive = grade => state.data.items.filter(task =>
  !task.completed&&task.deletedAt===null&&(grade===null||task.grade===grade)).length;
const canWrite=()=>goodStatus.has(state.status)&&!state.externalDirty&&!state.busy;
function readCurrent(){
  const result=adapter.load();
  state.status=result.status;
  state.data=result.data??EMPTY;
  state.selectedTags=pruneSelectedTags(state.data,state.selectedTags);
  state.externalDirty=false;
  render();
}
function failResult(result){
  if(result?.reason==='conflict'||result?.reason==='corrupt'||result?.reason==='unavailable'){
    state.externalDirty=true;
    render();
  }
  const map={conflict:'다른 탭에서 데이터가 변경됐습니다. 새로고침 후 다시 시도하십시오.',
    corrupt:'저장 데이터가 손상됐습니다. 복구 절차가 필요합니다.',
    unavailable:'브라우저 저장소에 접근할 수 없습니다.',
    quotaExceeded:'저장 용량이 부족합니다. JSON 백업을 확인하십시오.',
    revisionOverflow:'저장 수정 번호의 허용 범위를 초과했습니다.',
    transformFailed:'변경할 업무를 처리할 수 없습니다.',
    validationFailed:'업무 데이터 검증에 실패했습니다.',
    confirmationRequired:'작업을 확인해야 합니다.',backupFailed:'원본 보관에 실패했습니다.',
    noUndo:'취소할 이월 기록이 없습니다.',allConflicted:'취소 가능한 업무가 없습니다.'};
  toast(map[result?.reason]??'작업을 완료하지 못했습니다.',true);
}
async function commit(transform,successText='저장했습니다.'){
  if(!canWrite()){render();toast('현재 데이터를 수정할 수 없습니다. 저장 상태를 확인하십시오.',true);return false;}
  // Skip no-op without incrementing revision; update re-runs the transform on freshly loaded data.
  let proposed;
  try {proposed=transform(state.data);} catch(error){render();toast(error.message,true);return false;}
  if(proposed===state.data){toast('변경 사항이 없습니다.');return true;}
  state.busy=true;
  try {
    const result=await adapter.update(state.data.revision,transform);
    if(!result.ok){failResult(result);render();return false;}
    state.data=result.data;
    state.status=state.data.items.length?'ok':'empty';
    state.selectedTags=pruneSelectedTags(state.data,state.selectedTags);
    render();toast(successText);return true;
  } finally {state.busy=false;}
}
function metric(label,value,cls=''){
  return '<div class="metric"><div class="metric-name">'+escapeHtml(label)+'</div><div class="metric-num '+cls+'">'+value+'</div></div>';
}
function renderSummary(){
  const today=localDate();
  const active=state.data.items.filter(t=>t.deletedAt===null&&!t.completed);
  const completed=state.data.items.filter(t=>t.deletedAt===null&&t.completed);
  const due=active.filter(t=>getDateFlags(t,today).overdue).length;
  const scheduled=active.filter(t=>getDateFlags(t,today).today).length;
  byId('summary').innerHTML=metric('진행 중',active.length)+metric('오늘 예정',scheduled,'blue')+
    metric('기한 초과',due,'red')+metric('완료',completed.length);
}
function renderTags(){
  const tags=getTagOptions(state.data);
  byId('tag-filters').innerHTML=tags.length ? tags.map(({key,label})=>
    '<button class="chip" type="button" data-action="tag" data-key="'+escapeHtml(key)+
    '" aria-pressed="'+String(state.selectedTags.includes(key))+'">#'+escapeHtml(label)+'</button>').join(''):'';
  byId('clear-filters').hidden=!hasActiveFilter(state);
}
function renderTask(task){
  const flags=getDateFlags(task,localDate());
  const isComplete=state.view==='completed'||task.completed;
  const id=escapeHtml(task.id);
  const rank=task.order===null?'✓':escapeHtml(task.grade+String(task.order));
  const meta=[];
  if(task.scheduledDate)meta.push('<span class="'+(flags.today?'today-date':'')+'">예정 '+escapeHtml(task.scheduledDate)+'</span>');
  if(task.dueDate)meta.push('<span class="'+(flags.overdue?'due-over':'')+'">기한 '+escapeHtml(task.dueDate)+'</span>');
  if(isComplete)meta.push('<span>완료일 '+escapeHtml(task.completedDate??'미기록')+'</span>');
  for(const tag of task.tags)meta.push('<span class="tag">#'+escapeHtml(tag)+'</span>');
  let buttons='';
  if(state.view==='trash'){
    buttons='<button type="button" data-action="restore" data-id="'+id+'">복원</button>'+
      '<button type="button" data-action="delete-forever" data-id="'+id+'">영구 삭제</button>';
  } else {
    buttons='<button type="button" data-action="edit" data-id="'+id+'">수정</button>';
    if(state.view==='completed')buttons+='<button type="button" class="strong" data-action="reopen" data-id="'+id+'">완료 취소</button>';
    else {
      if(state.completionMode)buttons+='<label class="completion-check"><input type="checkbox" data-action="checkbox-complete" data-id="'+id+'"> 완료</label>';
      buttons+='<label class="rank-control">순번 <input type="number" min="0" max="'+(countActive(task.grade)-1)+'" value="'+task.order+'" data-action="rank" data-id="'+id+'" aria-label="우선순위 순번"></label>';
      buttons+='<button type="button" title="위로 이동" aria-label="위로 이동" data-action="up" data-id="'+id+'">↑</button>'+
        '<button type="button" title="아래로 이동" aria-label="아래로 이동" data-action="down" data-id="'+id+'">↓</button>'+
        '<select aria-label="등급 이동" data-action="move-grade" data-id="'+id+'">'+
        grades.map(g=>'<option value="'+g.grade+'"'+(task.grade===g.grade?' selected':'')+'>'+g.grade+'</option>').join('')+
        '</select>';
    }
    buttons+='<button type="button" data-action="trash" data-id="'+id+'">휴지통</button>';
  }
  const movable=state.view==='active'&&!hasActiveFilter(state);
  const drag=movable?'<span class="drag-handle" draggable="true" tabindex="0" role="button" aria-label="끌어서 순서 변경" data-id="'+id+'" title="끌어서 순서 변경">⋮⋮</span>':'';
  return '<article class="task-row" data-id="'+id+'" data-grade="'+escapeHtml(task.grade)+'">'+
    '<span class="rank">'+rank+'</span><div class="task-content"><button class="task-title" type="button" data-action="edit" data-id="'+id+'">'+escapeHtml(task.title)+'</button>'+
    (task.body?'<p class="task-body">'+escapeHtml(task.body)+'</p>':'')+
    '<div class="task-meta">'+meta.join('')+'</div></div><div class="task-actions">'+drag+buttons+'</div></article>';
}
function renderActive(){
  const completed=state.view==='completed';
  const items=filterTasks(state.data,{selectedTags:state.selectedTags,tagMode:state.tagMode,
    search:state.search,grade:state.grade,showCompleted:completed});
  if(!items.length)return '<div class="empty-state"><div><strong>표시할 업무가 없습니다.</strong><p>조건을 변경하거나 새로운 업무를 등록하십시오.</p></div></div>';
  return grades.filter(g=>state.grade===null||state.grade===g.grade).map(g=>{
    const matches=items.filter(t=>t.grade===g.grade);
    return '<section class="grade-section" data-grade="'+g.grade+'"><header class="grade-head">'+
      '<div class="grade-title"><span class="grade-pill '+g.grade+'">'+g.grade+'</span>'+
      '<div><h2>'+g.label+'</h2><p>'+g.sub+'</p></div></div>'+
      '<span class="grade-count">'+matches.length+'건</span></header>'+
      (matches.length?matches.map(renderTask).join(''):'<div class="empty-grade">이 등급에 표시할 업무가 없습니다.</div>')+
      '</section>';
  }).join('');
}
function renderTrash(){
  const deleted=listTrash(state.data).slice().sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));
  const stats=cleanupCandidates(state.data,new Date().toISOString());
  if(!deleted.length)return '<div class="empty-state">휴지통이 비어 있습니다.</div>';
  return '<section class="grade-section"><header class="grade-head"><div class="grade-title"><span class="grade-pill C">▤</span>'+
    '<div><h2>휴지통</h2><p>삭제한 업무는 자동으로 영구 삭제하지 않습니다.</p></div></div>'+
    '<span class="grade-count">'+deleted.length+'건 · 30일 경과 '+stats.count+'건'+(stats.warning?' · 정리 권장':'')+'</span></header>'+
    deleted.map(renderTask).join('')+'</section>';
}
function render(){
  const normal=goodStatus.has(state.status)&&!state.externalDirty;
  const titles={active:['업무 플래너','중요한 업무를 우선순위에 맞춰 정리합니다.'],
    completed:['완료한 업무','처리를 마친 업무를 확인하거나 완료를 취소할 수 있습니다.'],
    trash:['휴지통','삭제한 업무를 복원하거나 영구 삭제할 수 있습니다.']};
  const [title,subtitle]=titles[state.view];
  byId('view-heading').textContent=title;
  byId('page-title').textContent=title;byId('page-subtitle').textContent=subtitle;
  byId('today-label').textContent=localDate()+' · MY TASKS';
  byId('revision-label').textContent='revision '+state.data.revision;
  byId('storage-status').textContent=normal?'로컬 저장소 연결':'저장 차단 상태';
  byId('readonly-banner').hidden=normal;
  if(!normal){
    const corrupt=['corrupt','unsupportedVersion'].includes(state.status);
    byId('readonly-title').textContent=state.externalDirty?'다른 탭에서 변경됨':
      corrupt?'저장 데이터 복구 필요':'저장소 접근 불가';
    byId('readonly-details').textContent=state.externalDirty?
      '저장소가 변경되어 현재 탭의 쓰기를 차단했습니다. 다시 읽어야 합니다.':
      corrupt?'원본은 변경하지 않았습니다. 백업하거나 복구하십시오.':
      '브라우저 저장소에 접근할 수 없습니다. 저장 작업을 진행하지 않습니다.';
  }
  byId('new-task').disabled=!normal||state.view!=='active';
  byId('rollover-btn').hidden=state.view!=='active';
  byId('rollover-btn').disabled=!normal;
  byId('completion-mode').hidden=state.view!=='active';
  byId('completion-mode').disabled=!normal;
  byId('completion-mode').textContent='완료 모드 '+(state.completionMode?'ON':'OFF');
  byId('completion-mode').setAttribute('aria-pressed',String(state.completionMode));
  document.querySelectorAll('.side-link[data-view]').forEach(button=>
    button.classList.toggle('active',button.dataset.view===state.view));
  document.querySelector('.toolbar').hidden=state.view==='trash'||!normal;
  byId('tag-filters').hidden=state.view==='trash'||!normal;
  byId('summary').hidden=!normal;
  if(normal){renderSummary();renderTags();}
  byId('content').innerHTML=normal?
    (state.view==='trash'?renderTrash():renderActive()):
    '<div class="empty-state">데이터 보호를 위해 일반 업무 편집이 중지되었습니다.</div>';
  byId('footer-actions').innerHTML=normal?
    (state.view==='trash'?'<button class="btn danger" data-action="empty-trash">휴지통 비우기</button>':
      state.view==='completed'?'<button class="btn danger" data-action="clear-completed">완료 업무 모두 비우기</button>':
      (rollover.getRecord()?'<button class="btn subtle" data-action="undo-rollover">마지막 이월 취소</button>':'')):'';
}
async function exportRaw(){
  const raw=adapter.exportRaw();
  if(!raw.ok){failResult(raw);return;}
  const blob=new Blob([raw.raw??''],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;
  link.download='franklin-planner-'+localDate()+'-backup.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
  toast('JSON 다운로드를 요청했습니다. 실제 저장 여부를 확인하십시오.');
}
async function copyRaw(){
  const raw=adapter.exportRaw();
  if(!raw.ok){failResult(raw);return;}
  try{await navigator.clipboard.writeText(raw.raw??'');toast('원본 텍스트를 클립보드에 복사했습니다.');}
  catch{toast('클립보드 복사에 실패했습니다. 다운로드를 사용하십시오.',true);}
}
function openEditor(task=null){
  if(!canWrite())return;
  byId('task-id').value=task?.id??'';
  byId('editor-title').textContent=task?'업무 수정':'업무 추가';
  byId('task-title').value=task?.title??'';
  byId('task-body').value=task?.body??'';
  byId('task-grade').value=task?.grade??'A';
  byId('task-scheduled').value=task?.scheduledDate??'';
  byId('task-due').value=task?.dueDate??'';
  byId('task-tags').value=task?.tags.join(', ')??'';
  byId('form-error').hidden=true;
  byId('editor-backdrop').hidden=false;
  byId('task-title').focus();
}
function closeEditor(){byId('editor-backdrop').hidden=true;}
async function saveForm(event){
  event.preventDefault();
  const form=byId('task-form'),id=byId('task-id').value;
  const input={title:form.elements.title.value,body:form.elements.body.value,
    grade:form.elements.grade.value,scheduledDate:form.elements.scheduledDate.value||null,
    dueDate:form.elements.dueDate.value||null,
    tags:form.elements.tags.value.split(',').map(x=>x.trim()).filter(Boolean)};
  const now=new Date().toISOString();
  const newId=globalThis.crypto?.randomUUID?.()??('task_'+Date.now()+'_'+Math.random().toString(36).slice(2));
  try {
    const ok=await commit(data=>id?editTask(data,id,input,now):
      createTask(data,input,{id:newId,isoNow:now}),id?'업무를 수정했습니다.':'업무를 등록했습니다.');
    if(ok)closeEditor();
  } catch(err){byId('form-error').hidden=false;byId('form-error').textContent=err.message;}
}
async function importFromFile(file){
  if(!file)return;
  let backup;
  try {backup=JSON.parse(await file.text());}
  catch{toast('JSON 파일을 읽을 수 없습니다.',true);return;}
  const check=validateData(backup);
  if(!check.valid){toast('백업 데이터 검증 실패: '+check.errors[0],true);return;}
  const corrupt=['corrupt','unsupportedVersion'].includes(state.status);
  if(!corrupt&&!canWrite()){toast('현재 상태에서 가져오기를 진행할 수 없습니다.',true);return;}
  const confirmed=window.confirm(corrupt?
    '현재 손상 데이터를 보관하고 백업으로 복구합니다. 계속하시겠습니까?':
    '현재 저장된 업무 전체를 가져온 파일로 대체합니다. 계속하시겠습니까?');
  if(!confirmed)return;
  const result=corrupt?await adapter.restore(backup,{confirmed:true,externalPreserved:byId('recovery-preserved').checked}):
    await adapter.importBackup(backup,state.data.revision,true);
  if(!result.ok){failResult(result);return;}
  rollover.invalidate();readCurrent();toast('백업 데이터를 적용했습니다.');
}
async function resetRecovery(){
  if(!['corrupt','unsupportedVersion'].includes(state.status))return;
  if(!byId('recovery-preserved').checked){toast('원본을 실제로 별도 보존한 뒤 확인 체크를 선택하십시오.',true);return;}
  if(!window.confirm('원본을 외부에 보존했음을 확인합니다. 복구용 내부 사본도 생성한 뒤 업무 목록을 초기화합니다. 계속하시겠습니까?'))return;
  const result=await adapter.reset({confirmed:true,externalPreserved:true});
  if(!result.ok){failResult(result);return;}
  rollover.invalidate();readCurrent();toast('저장 데이터를 초기화했습니다.');
}
async function runRollover(){
  const today=localDate(),next=nextLocalDate();
  const planned=previewRollover(state.data,today,next);
  if(!planned.length){toast('이월할 업무가 없습니다.');return;}
  const preview=planned.map(c=>state.data.items.find(t=>t.id===c.taskId)?.title+' : '+c.before+' → '+c.after).join('\n');
  if(!window.confirm('실행 예정일을 '+next+'로 옮깁니다 ('+planned.length+'건).\n\n'+preview))return;
  const result=await rollover.rollover(state.data.revision,today,next,new Date().toISOString());
  if(!result.ok){failResult(result);return;}
  state.data=result.data;render();toast(result.changes.length+'개 업무를 이월했습니다.');
}
async function undoRollover(){
  const preview=rollover.previewUndo(state.data);
  if(!preview){toast('취소할 이월이 없습니다.',true);return;}
  if(!preview.restored.length){toast('취소 가능한 업무가 없습니다.',true);return;}
  const detail='복구 가능 '+preview.restored.length+'건 / 제외 '+preview.conflicts.length+'건\n'+
    preview.restored.map(c=>c.taskId+' → '+c.before).join('\n')+
    (preview.conflicts.length?'\n\n충돌로 제외: '+preview.conflicts.map(c=>c.taskId).join(', '):'');
  if(!window.confirm('마지막 이월을 취소하시겠습니까?\n\n'+detail))return;
  const result=await rollover.undo(state.data.revision,new Date().toISOString(),true);
  if(!result.ok){failResult(result);return;}
  state.data=result.data;render();toast(result.restored.length+'건 복구, '+result.conflicts.length+'건 제외');
}
async function clickAction(action,id,element){
  const now=new Date().toISOString(),task=state.data.items.find(t=>t.id===id);
  switch(action){
    case 'new':return openEditor();
    case 'edit':return task && openEditor(task);
    case 'complete':return commit(data=>completeTask(data,id,localDate(),now),'완료 처리했습니다.');
    case 'reopen':return commit(data=>reopenTask(data,id,now),'완료를 취소했습니다.');
    case 'up':return commit(data=>moveWithinGrade(data,id,Math.max(0,task.order-1)),'순서를 변경했습니다.');
    case 'down':return commit(data=>moveWithinGrade(data,id,Math.min(countActive(task.grade)-1,task.order+1)),'순서를 변경했습니다.');
    case 'trash':if(window.confirm('이 업무를 휴지통으로 이동합니까?'))
      return commit(data=>softDeleteTask(data,id,now),'휴지통으로 이동했습니다.');return;
    case 'restore':return commit(data=>restoreTrashTask(data,id,now),'업무를 복원했습니다.');
    case 'delete-forever':if(window.confirm('이 업무를 영구 삭제합니다. 되돌릴 수 없습니다.'))
      return commit(data=>permanentlyDeleteTask(data,id,true),'영구 삭제했습니다.');return;
    case 'empty-trash':if(window.confirm('휴지통의 모든 업무를 영구 삭제합니다. 계속하시겠습니까?'))
      return commit(data=>emptyTrash(data,true),'휴지통을 비웠습니다.');return;
    case 'clear-completed':if(window.confirm('완료한 업무를 모두 휴지통으로 이동하시겠습니까?'))
      return commit(data=>softDeleteCompleted(data,now).data,'완료 업무를 휴지통으로 이동했습니다.');return;
    case 'tag':{
      const key=element.dataset.key;
      state.selectedTags=state.selectedTags.includes(key)?state.selectedTags.filter(k=>k!==key):[...state.selectedTags,key];
      render();return;
    }
    case 'clear-filters':
      state.selectedTags=[];state.search='';state.grade=null;
      byId('search').value='';byId('filter-grade').value='';render();return;
    case 'toggle-completion':state.completionMode=!state.completionMode;render();return;
    case 'rollover':return runRollover();
    case 'undo-rollover':return undoRollover();
    case 'export':return exportRaw();
    case 'copy-raw':return copyRaw();
    case 'import':case 'recovery-file':return byId('import-file').click();
    case 'reset':return resetRecovery();
  }
}
function setup(){
  readCurrent();
  document.addEventListener('click',async event=>{
    const viewButton=event.target.closest('[data-view]');
    if(viewButton){
      state.view=viewButton.dataset.view;
      document.querySelector('.sidebar').classList.remove('open');
      render();return;
    }
    const button=event.target.closest('[data-action]');
    if(!button)return;
    try{await clickAction(button.dataset.action,button.dataset.id,button);}
    catch(err){toast(err.message,true);}
  });
  byId('task-form').addEventListener('submit',saveForm);
  byId('editor-close').addEventListener('click',closeEditor);
  byId('editor-cancel').addEventListener('click',closeEditor);
  byId('editor-backdrop').addEventListener('click',e=>{if(e.target===byId('editor-backdrop'))closeEditor();});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!byId('editor-backdrop').hidden)closeEditor();
  });
  byId('search').addEventListener('input',event=>{
    state.search=event.target.value;render();
  });
  byId('filter-grade').addEventListener('change',event=>{
    state.grade=event.target.value||null;render();
  });
  byId('tag-mode').addEventListener('change',event=>{
    state.tagMode=event.target.value;render();
  });
  byId('import-file').addEventListener('change',async e=>{
    try{await importFromFile(e.target.files[0]);}
    finally{e.target.value='';}
  });
  byId('refresh').addEventListener('click',()=>{
    if(!byId('editor-backdrop').hidden&&!window.confirm('작성 중인 내용을 버리고 다시 읽습니까?'))return;
    closeEditor();rollover.invalidate();readCurrent();
  });
  byId('menu-toggle').addEventListener('click',()=>document.querySelector('.sidebar').classList.toggle('open'));
  byId('content').addEventListener('change',event=>{
    const el=event.target,id=el.dataset.id,task=state.data.items.find(t=>t.id===id);
    if(!task)return;
    if(el.dataset.action==='checkbox-complete' && el.checked)
      commit(data=>completeTask(data,id,localDate(),new Date().toISOString()),'완료 처리했습니다.');
    if(el.dataset.action==='rank'){
      const index=Number(el.value);
      commit(data=>moveWithinGrade(data,id,index),'순서를 변경했습니다.');
    }
    if(el.dataset.action==='move-grade'&&el.value!==task.grade)
      commit(data=>moveTask(data,id,el.value,countActive(el.value)),'등급을 이동했습니다.');
  });
  // Desktop HTML5 drag-and-drop; mobile pointer support is scheduled for phase 5.
  byId('content').addEventListener('dragstart',event=>{
    const handle=event.target.closest('.drag-handle');
    if(!handle||hasActiveFilter(state)||state.view!=='active'){event.preventDefault();return;}
    state.dragId=handle.dataset.id;
    event.dataTransfer.effectAllowed='move';
    event.dataTransfer.setData('text/plain',state.dragId);
    handle.closest('.task-row').classList.add('dragging');
  });
  byId('content').addEventListener('dragover',event=>{
    if(!state.dragId||hasActiveFilter(state))return;
    const card=event.target.closest('.task-row'),section=event.target.closest('.grade-section');
    if(card||section){event.preventDefault();event.dataTransfer.dropEffect='move';}
  });
  byId('content').addEventListener('drop',async event=>{
    const source=state.data.items.find(t=>t.id===state.dragId);
    const card=event.target.closest('.task-row'),section=event.target.closest('.grade-section');
    if(!source||!section||hasActiveFilter(state))return;
    event.preventDefault();
    const targetGrade=section.dataset.grade;
    const target=card?state.data.items.find(t=>t.id===card.dataset.id):null;
    const targetLength=countActive(targetGrade);
    let index=target?.order??(targetLength-(source.grade===targetGrade?1:0));
    if(target&&source.grade===targetGrade&&source.order<target.order)index--;
    index=Math.max(0,index);
    state.dragId=null;
    try{await commit(data=>moveTask(data,source.id,targetGrade,index),'순서를 변경했습니다.');}
    catch(error){toast(error.message,true);}
  });
  document.addEventListener('dragend',()=>{
    state.dragId=null;
    document.querySelectorAll('.dragging').forEach(el=>el.classList.remove('dragging'));
  });
  window.addEventListener('storage',event=>{
    if(event.key===DEFAULT_STORAGE_KEY||event.key===null){
      state.externalDirty=true;rollover.invalidate();closeEditor();render();
    }
  });
}
setup();
