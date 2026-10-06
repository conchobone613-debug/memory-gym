import { db, getSettings } from '../db/db';
import { syncOnce, type SyncResult } from './engine';

/**
 * 자동 동기화 (2026-10-06).
 *
 * 동기화 코드가 있으면 '지금 맞추기'를 누르지 않아도 앱이 스스로 맞춘다.
 *  - 이 기기에서 이미지·궁전·기록이 바뀌면 잠시 뒤(LOCAL_DELAY) 올린다.
 *  - 다른 기기가 올리면 Firestore 가 바로 알려 주고(onSnapshot), 그때 받는다.
 *  - 앱을 열 때, 창으로 돌아올 때, 인터넷이 다시 붙을 때도 한 번 맞춘다.
 *
 * 끝없이 주고받지 않는 것은 `syncOnce` 가 바뀐 쪽에만 쓰기 때문이다(engine.ts).
 */

const WATCHED = [
  'imageSets', 'images', 'palaces', 'loci',
  'drillSessions', 'drillAttempts', 'recallSessions', 'recallCells',
  'mappingSessions', 'mappingAttempts', 'calcSessions', 'calcItems',
] as const;

const LOCAL_DELAY = 2_000;
const REMOTE_DELAY = 300;

export interface AutoStatus {
  state: 'off' | 'idle' | 'syncing' | 'error';
  last?: SyncResult;
  error?: string;
}

let status: AutoStatus = { state: 'off' };
const listeners = new Set<() => void>();
const setStatus = (s: AutoStatus) => { status = s; listeners.forEach((f) => f()); };
export const getAutoStatus = () => status;
export const subscribeAutoStatus = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let watching: { code: string; stop: () => void } | null = null;

/** ms 뒤에 한 번 맞춘다. 그 사이에 또 부르면 한 번으로 묶는다. */
export function scheduleSync(ms = 0) {
  clearTimeout(timer);
  timer = setTimeout(() => { void runSync(); }, ms);
}

/** 지금 맞추고 결과를 돌려준다(설정 화면의 '지금 맞추기'). 자동으로 도는 중이면 끝나길 기다린다. */
export async function syncNow(): Promise<AutoStatus> {
  clearTimeout(timer);
  while (running) await new Promise((r) => setTimeout(r, 100));
  await runSync();
  return status;
}

async function runSync() {
  if (running) { again = true; return; }
  const { syncCode } = await getSettings();
  if (!syncCode) { stopWatching(); setStatus({ state: 'off' }); return; }
  running = true;
  setStatus({ ...status, state: 'syncing' });
  try {
    /* Firebase SDK 는 동기화를 켠 기기에서만 받는다 */
    const { firestoreRemote, watchRemote } = await import('./firestore');
    const last = await syncOnce(firestoreRemote(syncCode));
    if (watching?.code !== syncCode) {
      stopWatching();
      watching = { code: syncCode, stop: watchRemote(syncCode, () => scheduleSync(REMOTE_DELAY)) };
    }
    setStatus({ state: 'idle', last });
  } catch (e) {
    setStatus({ ...status, state: 'error', error: (e as Error).message });
  } finally {
    running = false;
    if (again) { again = false; scheduleSync(LOCAL_DELAY); }
  }
}

function stopWatching() {
  watching?.stop();
  watching = null;
}

/** 앱이 뜰 때 한 번 부른다. */
export function startAutoSync() {
  for (const name of WATCHED) {
    const t = db.table(name);
    /* 맞추는 중이면 끝난 뒤 한 번 더 — 받아 넣은 것뿐이면 그 판은 할 일 없이 끝난다 */
    const touched = () => { if (running) again = true; else scheduleSync(LOCAL_DELAY); };
    t.hook('creating', touched);
    t.hook('updating', touched);
    t.hook('deleting', touched);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(); });
  window.addEventListener('online', () => scheduleSync());
  scheduleSync();
}
