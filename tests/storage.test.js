import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorageAdapter } from '../src/storage.js';
import { classifyRaw, validateData, isValidLocalDate } from '../src/validator.js';

const KEY = 'franklin_planner_data_v1';
class FakeStorage {
  #data = new Map();
  throwRead = false;
  throwWrite = false;
  get length() { return this.#data.size; }
  key(i) { return [...this.#data.keys()][i] ?? null; }
  getItem(key) {
    if (this.throwRead) throw new DOMException('read blocked', 'SecurityError');
    return this.#data.get(key) ?? null;
  }
  setItem(key, value) {
    if (this.throwWrite) throw new DOMException('full', 'QuotaExceededError');
    this.#data.set(key, String(value));
  }
  removeItem(key) { this.#data.delete(key); }
}
const empty = () => ({ schemaVersion: 1, revision: 0, items: [] });
const task = (id = 't1') => ({
  id, title: '검토', body: '', grade: 'A', order: 0,
  scheduledDate: null, scheduleRevision: 0, dueDate: null, completed: false,
  completedDate: null, tags: ['업무'], deletedAt: null,
  createdAt: '2026-11-16T04:00:00.000Z', updatedAt: '2026-11-16T04:00:00.000Z'
});
const add = value => ({ ...value, items: [...value.items, task()] });

test('missing: first write commits revision 1', async () => {
  const storage = new FakeStorage(), adapter = createStorageAdapter(storage);
  assert.equal(adapter.load().status, 'missing');
  const result = await adapter.update(0, add);
  assert.equal(result.ok, true);
  assert.equal(result.revision, 1);
  assert.equal(JSON.parse(storage.getItem(KEY)).items.length, 1);
});

test('failed first write creates no storage key', async () => {
  const storage = new FakeStorage(), adapter = createStorageAdapter(storage);
  adapter.load(); storage.throwWrite = true;
  assert.deepEqual(await adapter.update(0, add), { ok:false, reason:'quotaExceeded' });
  assert.equal(storage.getItem(KEY), null);
});

test('invalid JSON/array/empty string vs valid empty document', () => {
  for (const raw of ['{bad', '[]', '']) assert.equal(classifyRaw(raw).status, 'corrupt');
  assert.equal(classifyRaw(JSON.stringify(empty())).status, 'empty');
  assert.equal(classifyRaw(null).status, 'missing');
  assert.equal(classifyRaw('{"schemaVersion":2,"revision":0,"items":[]}').status, 'unsupportedVersion');
});

test('invalid task, duplicate ID, invalid date and gapped order rejected', () => {
  const cases = [
    { ...empty(), items:[null] },
    { ...empty(), items:[task(), {...task(), order:1}] },
    { ...empty(), items:[{...task(), scheduledDate:'2026-02-30'}] },
    { ...empty(), items:[{...task(), order:2}] }
  ];
  for (const value of cases) assert.equal(validateData(value).valid, false);
  assert.equal(isValidLocalDate('2024-02-29'), true);
});

test('completed task may have missing completedDate but requires null order', () => {
  const completed = {...task(), completed:true, completedDate:null, order:null};
  assert.equal(validateData({...empty(), items:[completed]}).valid, true);
  assert.equal(validateData({...empty(), items:[{...completed, order:0}]}).valid, false);
});

test('revision conflict leaves stored data unchanged', async () => {
  const storage = new FakeStorage(), adapter = createStorageAdapter(storage);
  storage.setItem(KEY, JSON.stringify(empty()));
  const before = storage.getItem(KEY);
  assert.equal((await adapter.update(3, add)).reason, 'conflict');
  assert.equal(storage.getItem(KEY), before);
});

test('transform exception and invalid candidate do not commit', async () => {
  const storage = new FakeStorage(), adapter = createStorageAdapter(storage);
  storage.setItem(KEY, JSON.stringify(empty()));
  assert.equal((await adapter.update(0, () => { throw Error('bad'); })).reason, 'transformFailed');
  assert.equal((await adapter.update(0, () => ({...empty(), items:[null]}))).reason, 'validationFailed');
  assert.equal(JSON.parse(storage.getItem(KEY)).revision, 0);
});

test('external corruption after load blocks update', async () => {
  const storage = new FakeStorage(), adapter = createStorageAdapter(storage);
  adapter.load(); storage.setItem(KEY, '{broken');
  assert.equal((await adapter.update(0, add)).reason, 'corrupt');
  assert.equal(storage.getItem(KEY), '{broken');
});

test('getItem exceptions are unavailable, not missing', () => {
  const storage = new FakeStorage(), adapter = createStorageAdapter(storage);
  storage.throwRead = true;
  assert.equal(adapter.load().status, 'unavailable');
  assert.equal(adapter.exportRaw().reason, 'unavailable');
});

test('revision overflow is not quotaExceeded', async () => {
  const storage = new FakeStorage(), adapter = createStorageAdapter(storage);
  storage.setItem(KEY, JSON.stringify({...empty(), revision:Number.MAX_SAFE_INTEGER}));
  assert.equal((await adapter.update(Number.MAX_SAFE_INTEGER, add)).reason, 'revisionOverflow');
});

test('normal import discards backup revision, requires confirmation', async () => {
  const storage = new FakeStorage(), adapter = createStorageAdapter(storage);
  storage.setItem(KEY, JSON.stringify({...empty(), revision:4}));
  const backup = { schemaVersion:1, revision:200, items:[task()] };
  assert.equal((await adapter.importBackup(backup, 4, false)).reason, 'confirmationRequired');
  const result = await adapter.importBackup(backup, 4, true);
  assert.equal(result.revision, 5);
  assert.equal(result.data.items.length, 1);
});

test('corruption recovery preserves an exact copy of original', async () => {
  const storage = new FakeStorage(), adapter = createStorageAdapter(storage, {
    now: () => '2026-11-16T00:00:00Z', random: () => 'abc'
  });
  storage.setItem(KEY, '{broken');
  assert.equal(adapter.load().status, 'corrupt');
  assert.equal((await adapter.update(0, add)).reason, 'corrupt');
  const result = await adapter.restore(empty(), {confirmed:true});
  assert.equal(result.ok, true);
  assert.equal(storage.getItem(result.backupKey), '{broken');
  assert.equal(adapter.load().status, 'empty');
});

test('recovery does not overwrite data changed by another tab', async () => {
  const storage = new FakeStorage(), adapter = createStorageAdapter(storage);
  storage.setItem(KEY, '{broken'); adapter.load();
  storage.setItem(KEY, JSON.stringify(empty()));
  assert.equal((await adapter.reset({confirmed:true})).reason, 'conflict');
  assert.equal(JSON.parse(storage.getItem(KEY)).revision, 0);
});

test('recovery refuses to overwrite without backup or external preservation', async () => {
  const storage = new FakeStorage(), adapter = createStorageAdapter(storage);
  storage.setItem(KEY, '{broken'); adapter.load();
  storage.throwWrite = true;
  assert.equal((await adapter.reset({confirmed:true})).reason, 'backupFailed');
  assert.equal(storage.getItem(KEY), '{broken');
});

test('invalid recovery backup leaves original corrupt data intact', async () => {
  const storage = new FakeStorage(), adapter = createStorageAdapter(storage);
  storage.setItem(KEY, '{broken'); adapter.load();
  assert.equal((await adapter.restore({...empty(),items:[null]}, {confirmed:true})).reason, 'validationFailed');
  assert.equal(storage.getItem(KEY), '{broken');
});

test('pure transforms cannot mutate their frozen input', async () => {
  const storage = new FakeStorage(), adapter = createStorageAdapter(storage);
  storage.setItem(KEY, JSON.stringify(empty()));
  assert.equal((await adapter.update(0, value => { value.items.push(task()); return value; })).reason, 'transformFailed');
});


test('two consecutive corrupt incidents keep both exact backups without overwriting', async () => {
  const storage=new FakeStorage();
  let id=0;
  const adapter=createStorageAdapter(storage,{
    now:()=> '2026-11-16T06:00:00.000Z',
    random:()=> 'fixed-' + (++id)
  });
  storage.setItem(KEY,'{incident-one');
  assert.equal(adapter.load().status,'corrupt');
  const first=await adapter.reset({confirmed:true});
  assert.equal(first.ok,true);
  assert.equal(storage.getItem(first.backupKey),'{incident-one');
  storage.setItem(KEY,'{incident-two');
  assert.equal(adapter.load().status,'corrupt');
  const second=await adapter.reset({confirmed:true});
  assert.equal(second.ok,true);
  assert.notEqual(second.backupKey,first.backupKey);
  assert.equal(storage.getItem(first.backupKey),'{incident-one');
  assert.equal(storage.getItem(second.backupKey),'{incident-two');
  assert.deepEqual(adapter.listCorruptBackups().keys.sort(),[first.backupKey,second.backupKey].sort());
});

test('colliding backup key is never overwritten and a fresh key is used', async () => {
  const storage=new FakeStorage();
  let n=0;
  const adapter=createStorageAdapter(storage,{
    now:()=> '2026-11-16T06:00:00.000Z',
    random:()=> ++n===1?'collision':'unique'
  });
  const occupied=KEY+'-corrupt-2026-11-16T06:00:00.000Z-collision';
  storage.setItem(occupied,'important older backup');
  storage.setItem(KEY,'{new-incident');
  adapter.load();
  const result=await adapter.reset({confirmed:true});
  assert.equal(result.ok,true);
  assert.equal(storage.getItem(occupied),'important older backup');
  assert.equal(storage.getItem(result.backupKey),'{new-incident');
});

test('mismatched verification read of corrupt backup refuses recovery and retains primary', async () => {
  class MismatchStorage extends FakeStorage {
    getItem(k) {
      const value=super.getItem(k);
      return k.includes('-corrupt-') && value!==null?'altered copy':value;
    }
  }
  const storage=new MismatchStorage(),adapter=createStorageAdapter(storage);
  storage.setItem(KEY,'{unparsed');
  adapter.load();
  assert.equal((await adapter.reset({confirmed:true})).reason,'backupFailed');
  assert.equal(storage.getItem(KEY),'{unparsed');
  assert.equal((await adapter.update(0,add)).reason,'corrupt');
});

test('explicit external preservation permits recovery only when internal backup write fails', async () => {
  class FailedBackupStorage extends FakeStorage {
    setItem(k,v) {
      if(k.includes('-corrupt-')) throw new DOMException('full','QuotaExceededError');
      super.setItem(k,v);
    }
  }
  const storage=new FailedBackupStorage(),adapter=createStorageAdapter(storage);
  storage.setItem(KEY,'{broken');
  assert.equal(adapter.load().status,'corrupt');
  assert.equal((await adapter.reset({confirmed:true,externalPreserved:false})).reason,'backupFailed');
  assert.equal(storage.getItem(KEY),'{broken');
  const result=await adapter.reset({confirmed:true,externalPreserved:true});
  assert.equal(result.ok,true);
  assert.equal(result.backupKey,null);
  assert.equal(adapter.load().status,'empty');
});

test('backup preservation confirmation cannot override a changed primary snapshot', async () => {
  class FailedBackupStorage extends FakeStorage {
    setItem(k,v) {
      if(k.includes('-corrupt-')) throw new Error('storage blocked');
      super.setItem(k,v);
    }
  }
  const storage=new FailedBackupStorage(),adapter=createStorageAdapter(storage);
  storage.setItem(KEY,'{old');
  adapter.load();
  storage.setItem(KEY,'{new');
  const result=await adapter.reset({confirmed:true,externalPreserved:true});
  assert.equal(result.reason,'conflict');
  assert.equal(storage.getItem(KEY),'{new');
});
