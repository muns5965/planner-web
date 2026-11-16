import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = new URL('../', import.meta.url);
const generated = new URL('../dist/franklin-planner.html', import.meta.url);

test('single HTML build has inline styles and inline JavaScript, no external assets', async () => {
  await exec(process.execPath, ['scripts/build-single-html.js'], {cwd:root});
  const html = await readFile(generated, 'utf8');
  assert.match(html, /<style>[\s\S]*\.sidebar/);
  assert.match(html, /<script type="module">[\s\S]*createStorageAdapter/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+stylesheet/);
  assert.doesNotMatch(html, /\bimport\s*\{/);
  assert.match(html, /Franklin Planner/);
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script && script.length > 25000);
  const {mkdtemp,writeFile,rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(),'franklin-check-'));
  try {
    const js = join(dir,'check.mjs');
    await writeFile(js,script);
    await exec(process.execPath,['--check',js]);
  } finally {await rm(dir,{recursive:true,force:true});}
});
