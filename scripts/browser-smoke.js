#!/usr/bin/env node
// Chromium/Chrome CDP smoke test, no additional npm dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fileUrl=pathToFileURL(resolve(root,'dist/franklin-planner.html')).href;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function findChrome(){
  if(process.env.CHROME_BIN)return process.env.CHROME_BIN;
  for(const name of ['chromium','google-chrome','google-chrome-stable']){
    const found=spawnSync('which',[name],{encoding:'utf8'});
    if(found.status===0)return found.stdout.trim();
  }
  throw Error('Chromium or Chrome is required; browser test cannot run');
}
const port=37219;
const dir=await mkdtemp(join(tmpdir(),'franklin-chrome-'));
const child=spawn(findChrome(),[
  '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
  '--no-first-run','--no-default-browser-check','--disable-background-networking',
  '--remote-allow-origins=*','--remote-debugging-port='+port,'--user-data-dir='+dir,'about:blank'
],{stdio:'ignore'});
let socket,id=0,unexpected=[];
const pending=new Map();
async function connect(){
  let pages;
  for(let n=0;n<120;n++){
    if(child.exitCode!==null)throw Error('Chrome stopped prematurely');
    try{
      const response=await fetch('http://127.0.0.1:'+port+'/json/list');
      if(response.ok){
        pages=await response.json();
        if(pages.some(p=>p.type==='page'))break;
      }
    }catch{}
    await sleep(100);
  }
  const target=pages?.find(p=>p.type==='page');
  if(!target)throw Error('Chrome debugging target unavailable');
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    socket.addEventListener('open',resolve,{once:true});
    socket.addEventListener('error',reject,{once:true});
  });
  socket.addEventListener('message',event=>{
    const m=JSON.parse(event.data);
    if(m.method==='Runtime.exceptionThrown')
      unexpected.push(m.params.exceptionDetails?.exception?.description??'Browser exception');
    if(!m.id)return;
    const p=pending.get(m.id);
    if(!p)return;
    pending.delete(m.id);
    if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);
  });
}
function send(method,params={}){
  return new Promise((resolve,reject)=>{
    const current=++id;pending.set(current,{resolve,reject});
    socket.send(JSON.stringify({id:current,method,params}));
  });
}
async function evaluate(expression){
  const response=await send('Runtime.evaluate',{
    expression,returnByValue:true,awaitPromise:true,userGesture:true
  });
  if(response.exceptionDetails)throw Error(
    response.exceptionDetails.exception?.description??response.exceptionDetails.text);
  return response.result?.value;
}
async function until(expression,label){
  for(let i=0;i<120;i++){
    if(await evaluate(expression))return;
    await sleep(80);
  }
  throw Error('Timeout: '+label);
}
async function check(expression,label){
  if(!await evaluate(expression))throw Error('Failed: '+label);
  console.log('PASS '+label);
}
try{
  await connect();
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.navigate',{url:fileUrl});
  await until("document.readyState==='complete' && document.querySelector('#storage-status')?.textContent==='로컬 저장소 연결'",'startup');
  await check("document.querySelector('#readonly-banner').hidden",'file starts with localStorage');
  await evaluate("window.confirm=()=>true");
  await evaluate("document.querySelector('[data-action=new]').click()");
  await evaluate("document.querySelector('#task-title').value='브라우저 시험 업무'");
  await evaluate("document.querySelector('#task-body').value='데이터 지속성'");
  await evaluate("document.querySelector('#task-scheduled').value='2026-11-15'");
  await evaluate("document.querySelector('#task-tags').value='확인, 테스트'");
  await evaluate("document.querySelector('#task-form').requestSubmit()");
  await until("JSON.parse(localStorage.getItem('franklin_planner_data_v1')||'{}').items?.length===1",'create task');
  await check("document.querySelector('.task-title')?.textContent==='브라우저 시험 업무'",'new task renders');
  await check("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).revision===1",'first save increments revision');
  await evaluate("document.querySelector('#search').value='일치하지 않는 검색'");
  await evaluate("document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}))");
  await check("!!document.querySelector('.empty-state')",'search filters results');
  await evaluate("document.querySelector('#clear-filters').click()");
  await check("!!document.querySelector('.task-row')",'clear filters');
  await evaluate("document.querySelector('[data-action=rollover]').click()");
  await until("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).items[0].scheduleRevision===1",'rollover');
  await check("document.querySelector('[data-action=undo-rollover]')!==null",'undo becomes available');
  await evaluate("document.querySelector('[data-action=undo-rollover]').click()");
  await until("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).items[0].scheduledDate==='2026-11-15'",'rollover undo');
  await evaluate("document.querySelector('[data-action=toggle-completion]').click()");
  await check("document.querySelector('[data-action=checkbox-complete]')!==null",'completion mode checkbox');
  await evaluate("(()=>{const x=document.querySelector('[data-action=checkbox-complete]');x.checked=true;x.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await until("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).items[0].completed===true",'complete');
  await evaluate("document.querySelector('[data-view=completed]').click()");
  await check("document.querySelector('[data-action=reopen]')!==null",'completed view');
  await evaluate("document.querySelector('[data-action=reopen]').click()");
  await until("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).items[0].completed===false",'reopen');
  await evaluate("document.querySelector('[data-view=active]').click()");
  await evaluate("document.querySelector('[data-action=trash]').click()");
  await until("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).items[0].deletedAt!==null",'trash');
  await evaluate("document.querySelector('[data-view=trash]').click()");
  await check("document.querySelector('[data-action=restore]')!==null",'trash view');
  await evaluate("document.querySelector('[data-action=restore]').click()");
  await until("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).items[0].deletedAt===null",'restore');
  // Keyboard ordering and mobile touch interaction on actual DOM input events.
  await evaluate("document.querySelector('[data-view=active]').click()");
  await evaluate("document.querySelector('[data-action=new]').click()");
  await evaluate("document.querySelector('#task-title').value='정렬 검증 업무'");
  await evaluate("document.querySelector('#task-form').requestSubmit()");
  await until("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).items.length===2",'second task');
  await check("document.querySelectorAll('.drag-handle').length===2",'two reorder handles');
  await evaluate("document.querySelectorAll('.drag-handle')[1].focus()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
  await until("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).items.find(x=>x.title==='정렬 검증 업무').order===0",'keyboard reorder');
  console.log('PASS keyboard Up reorders focused handle');

  await send('Emulation.setDeviceMetricsOverride',{
    width:390,height:844,deviceScaleFactor:1,mobile:true
  });
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await evaluate("window.scrollTo(0,0)");
  const coordinates=await evaluate("(()=>{const rows=[...document.querySelectorAll('.task-row')];const ordered=rows.sort((a,b)=>Number(a.querySelector('.rank').textContent.slice(1))-Number(b.querySelector('.rank').textContent.slice(1)));const handle=ordered[1].querySelector('.drag-handle').getBoundingClientRect();const target=ordered[0].getBoundingClientRect();return {from:{x:handle.x+handle.width/2,y:handle.y+handle.height/2},to:{x:target.x+30,y:target.y+target.height/4}}})()");
  const storedRevision=await evaluate("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).revision");
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...coordinates.from,id:1}]});
  await send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await sleep(200);
  await check("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).revision==="+storedRevision,'pointercancel keeps revision unchanged');
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...coordinates.from,id:2}]});
  await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...coordinates.to,id:2}]});
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await until("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).revision==="+(storedRevision+1),'touch reorder saved');
  console.log('PASS mobile touch moves task order and commits once');

  const revision=await evaluate("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).revision");
  await send('Page.reload',{ignoreCache:true});
  await until("document.readyState==='complete' && document.querySelector('.task-title')?.textContent==='브라우저 시험 업무'",'reload');
  await check("JSON.parse(localStorage.getItem('franklin_planner_data_v1')).revision==="+revision,'saved revision survives reload');
  if(unexpected.length)throw Error('Uncaught browser errors:\n'+unexpected.join('\n'));
  console.log('Browser smoke PASSED: file://, edit, search, rollover, completed, trash, persistence');
}catch(err){console.error(err.stack??String(err));process.exitCode=1;}
finally{
  socket?.close();
  child.kill('SIGTERM');await sleep(200);
  await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
}
