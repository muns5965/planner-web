import { classifyRaw, validateData } from './validator.js';

export const DEFAULT_STORAGE_KEY = 'franklin_planner_data_v1';
const noopLock = async fn => fn();
const clone = value => structuredClone(value);
const freezeDeep = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
};
const failure = reason => ({ ok: false, reason });
const storageError = error => error?.name === 'QuotaExceededError' ? 'quotaExceeded' : 'unavailable';

/**
 * Inject storage for tests. A lock(asyncFn) option may be supplied by a host
 * that supports Web Locks. Without it, revision checks are best-effort only.
 */
export function createStorageAdapter(storage, {
  key = DEFAULT_STORAGE_KEY,
  lock = noopLock,
  now = () => new Date().toISOString(),
  random = () => crypto.randomUUID()
} = {}) {
  let recoverySnapshot = null;
  let recoveryMode = false;

  function load() {
    try {
      const raw = storage.getItem(key);
      const result = classifyRaw(raw);
      if (result.status === 'corrupt' || result.status === 'unsupportedVersion') {
        recoveryMode = true;
        recoverySnapshot = raw;
      } else {
        recoveryMode = false;
        recoverySnapshot = null;
      }
      return result;
    } catch {
      return { status: 'unavailable' };
    }
  }

  function exportRaw() {
    try { return { ok: true, raw: storage.getItem(key) }; }
    catch { return failure('unavailable'); }
  }

  async function withLock(work) {
    try { return await lock(work); }
    catch (error) { return failure(storageError(error) === 'quotaExceeded' ? 'quotaExceeded' : 'lockFailed'); }
  }

  async function update(expectedRevision, transform) {
    if (recoveryMode) return failure('corrupt');
    return withLock(async () => {
      let raw;
      try { raw = storage.getItem(key); }
      catch { return failure('unavailable'); }
      const currentState = classifyRaw(raw);
      if (['corrupt', 'unsupportedVersion'].includes(currentState.status)) {
        recoveryMode = true;
        recoverySnapshot = raw;
        return failure('corrupt');
      }
      const current = currentState.data;
      if (current.revision !== expectedRevision) return failure('conflict');
      if (current.revision === Number.MAX_SAFE_INTEGER) return failure('revisionOverflow');

      let candidate;
      try { candidate = await transform(freezeDeep(clone(current))); }
      catch { return failure('transformFailed'); }
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return failure('validationFailed');
      candidate = { ...candidate, schemaVersion: 1, revision: current.revision + 1 };
      if (!validateData(candidate).valid) return failure('validationFailed');
      try { storage.setItem(key, JSON.stringify(candidate)); }
      catch (error) { return failure(storageError(error)); }
      return { ok: true, data: clone(candidate), revision: candidate.revision };
    });
  }

  async function importBackup(backup, expectedRevision, confirmed = false) {
    if (!confirmed) return failure('confirmationRequired');
    if (!validateData(backup).valid) return failure('validationFailed');
    return update(expectedRevision, () => clone(backup));
  }

  async function recover(replacement, { confirmed = false, externalPreserved = false } = {}) {
    if (!recoveryMode || recoverySnapshot === null) return failure('notInRecoveryMode');
    if (!confirmed) return failure('confirmationRequired');
    if (!validateData(replacement).valid) return failure('validationFailed');
    const snapshot = recoverySnapshot;
    return withLock(async () => {
      let backupKey = null;
      try {
        for (let i = 0; i < 8; i++) {
          const candidate = key + '-corrupt-' + now() + '-' + random();
          if (storage.getItem(candidate) === null) { backupKey = candidate; break; }
        }
        if (!backupKey) return failure('backupFailed');
        storage.setItem(backupKey, snapshot);
        if (storage.getItem(backupKey) !== snapshot) return failure('backupFailed');
      } catch {
        if (!externalPreserved) return failure('backupFailed');
        backupKey = null;
      }

      let latest;
      try { latest = storage.getItem(key); }
      catch { return failure('unavailable'); }
      if (latest !== snapshot) return failure('conflict');

      const target = clone(replacement);
      try { storage.setItem(key, JSON.stringify(target)); }
      catch (error) { return failure(storageError(error)); }
      recoveryMode = false;
      recoverySnapshot = null;
      return { ok: true, data: target, revision: target.revision, backupKey };
    });
  }

  async function restore(backup, options) { return recover(backup, options); }
  async function reset({ confirmed = false, externalPreserved = false } = {}) {
    return recover({ schemaVersion: 1, revision: 1, items: [] }, { confirmed, externalPreserved });
  }

  function listCorruptBackups() {
    try {
      const keys = [];
      const prefix = key + '-corrupt-';
      for (let i = 0; i < storage.length; i++) {
        const found = storage.key(i);
        if (found?.startsWith(prefix)) keys.push(found);
      }
      return { ok: true, keys: keys.sort() };
    } catch { return failure('unavailable'); }
  }

  return { load, update, importBackup, restore, reset, exportRaw, listCorruptBackups };
}
