import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('browser entry has the interactive controls used by the UI module',async()=>{
 const [html,ui]=await Promise.all([read('index.html'),read('src/ui.js')]);
 const ids=[...ui.matchAll(/byId\('([^']+)'\)/g)].map(m=>m[1]);
 assert.ok(ids.length>20);
 for(const id of new Set(ids))
  assert.ok(html.includes('id="'+id+'"'), 'missing HTML control: '+id);
});
test('browser entry loads local CSS and module without network dependencies',async()=>{
 const html=await read('index.html');
 assert.match(html,/href="\.\/src\/styles\.css"/);
 assert.match(html,/type="module" src="\.\/src\/ui\.js"/);
 assert.doesNotMatch(html,/<script[^>]+https?:\/\//i);
 assert.doesNotMatch(html,/<link[^>]+https?:\/\//i);
});
test('completed toggle, recovery check, task form and filter controls are present',async()=>{
 const html=await read('index.html');
 for(const id of ['completion-mode','recovery-preserved','task-form',
  'task-title','task-grade','task-due','task-scheduled','task-tags',
  'clear-filters','tag-mode','filter-grade','import-file'])
  assert.ok(html.includes('id="'+id+'"'),id);
});
test('local preview server serves HTML and ES modules with correct content types',async t=>{
 const port=41833;
 const child=spawn(process.execPath,['scripts/dev-server.js'],{
  cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(()=>child.kill());
 let response;
 for(let i=0;i<40;i++){
  try{response=await fetch('http://127.0.0.1:'+port+'/');break;}
  catch{await new Promise(resolve=>setTimeout(resolve,50));}
 }
 assert.ok(response,'local server failed to start');
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-type'),/text\/html/);
 assert.match(await response.text(),/플래너/);
 const module=await fetch('http://127.0.0.1:'+port+'/src/ui.js');
 assert.equal(module.status,200);
 assert.match(module.headers.get('content-type'),/text\/javascript/);
 assert.match(await module.text(),/createStorageAdapter/);
 const forbidden=await fetch('http://127.0.0.1:'+port+'/package.json');
 assert.equal(forbidden.status,200);
});


test('visual shell keeps accessible mobile navigation and live grade help',async()=>{
 const [html,ui,css]=await Promise.all([read('index.html'),read('src/ui.js'),read('src/styles.css')]);
 for(const id of ['mobile-more','grade-hint','task-grade'])
   assert.ok(html.includes('id="'+id+'"'),'missing UI element '+id);
 assert.match(html,/aria-describedby="grade-hint"/);
 assert.match(html,/class="mobile-dock"/);
 assert.match(html,/class="mobile-fab" data-action="new"/);
 assert.match(ui,/function updateGradeHint\(/);
 assert.match(ui,/addEventListener\('change',updateGradeHint\)/);
 assert.match(ui,/\.mobile-dock-item\[data-view\]/);
 assert.match(css,/env\(safe-area-inset-bottom\)/);
 assert.match(css,/\.mobile-dock-pill/);
});
