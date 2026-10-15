import { Field, Template, Source } from '../types';

export const LS_KEY = 'gosa-fields-v3';
export const HID_KEY = 'gosa-hidden-builtins';

export const DEFAULT_FIELDS: Field[] = [
  { key: '학년도', value: '2026' },
  { key: '학기', value: '2' },
  { key: '고사명', value: '기말고사' },
  { key: '시험일', type: 'dates', value: [] },
];

export const FIXED_KEYS = new Set(DEFAULT_FIELDS.map((f) => f.key));

export function loadFields(): Field[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || '');
    if (Array.isArray(v) && v.length) return v;
  } catch (e) {}

  const base: Field[] = JSON.parse(JSON.stringify(DEFAULT_FIELDS));
  try {
    const old = JSON.parse(localStorage.getItem('gosa-fields-v2') || '');
    if (Array.isArray(old)) {
      for (const f of base) {
        const o = old.find((x: any) => x.key === f.key);
        if (o && o.value && f.type !== 'dates') f.value = o.value;
      }
    }
  } catch (e) {}
  return base;
}

export function saveFields(fields: Field[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(fields));
  } catch (e) {}
}

export function hiddenBuiltins(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HID_KEY) || '');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

export function setHiddenBuiltins(arr: string[]) {
  try {
    localStorage.setItem(HID_KEY, JSON.stringify(arr));
  } catch (e) {}
}

let dbInstance: IDBDatabase | null = null;

export function initDB(): Promise<IDBDatabase | null> {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((res) => {
    try {
      const r = indexedDB.open('gosa-templates', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('t')) d.createObjectStore('t', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('s')) d.createObjectStore('s', { keyPath: 'id' });
      };
      r.onsuccess = () => {
        dbInstance = r.result;
        res(r.result);
      };
      r.onerror = () => res(null);
    } catch (e) {
      res(null);
    }
  });
}

export function idbAll<T>(st: 't' | 's' = 't'): Promise<T[]> {
  return new Promise((res) => {
    if (!dbInstance) return res([]);
    try {
      const q = dbInstance.transaction(st).objectStore(st).getAll();
      q.onsuccess = () => res((q.result || []) as T[]);
      q.onerror = () => res([]);
    } catch (e) {
      res([]);
    }
  });
}

export function idbPut(t: Template) {
  if (!dbInstance) return;
  try {
    const { cache, styles, ...rec } = t;
    dbInstance.transaction('t', 'readwrite').objectStore('t').put(rec);
  } catch (e) {}
}

export function idbPutTo(st: 't' | 's', rec: any) {
  if (!dbInstance) return;
  try {
    dbInstance.transaction(st, 'readwrite').objectStore(st).put(rec);
  } catch (e) {}
}

export function idbDelFrom(st: 't' | 's', id: string) {
  if (!dbInstance) return;
  try {
    dbInstance.transaction(st, 'readwrite').objectStore(st).delete(id);
  } catch (e) {}
}

export function idbDel(id: string) {
  return idbDelFrom('t', id);
}

const saveTimers: Record<string, any> = {};
export function persistTemplate(t: Template) {
  clearTimeout(saveTimers[t.id]);
  saveTimers[t.id] = setTimeout(() => idbPut(t), 400);
}
