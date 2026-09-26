import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, getSettings, saveSettings } from '../db/db';
import { BATCH_BYTES, splitRows, syncOnce, type Remote } from './engine';

/*
 * 회상 칸은 시각이 없어 '마지막 동기화 뒤' 비교로는 한 번도 올라가지 않았다(2026-09-26 수리).
 * 칸이 판을 따라 올라가는지, 그 전에 동기화한 기기가 옛 칸을 한 번만 되채우는지 본다.
 */

type Rows = Record<string, { id: string }[]>;

/** JSON 을 UTF-8 로 적은 크기 — Firestore 가 문서 크기를 세는 단위 */
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** Firestore 대신 메모리에 담는 창구. 올린 묶음을 그대로 남겨 들여다본다. 1MiB 넘는 묶음은 Firestore 처럼 거절한다. */
function memoryRemote(failAt = -1) {
  const batches: { id: string; createdAt: number; rows: Rows }[] = [];
  let puts = 0;
  const remote: Remote = {
    async getAssets() { return null; },
    async putAssets() {},
    async listBatches(after) { return batches.filter((b) => b.createdAt > after) as never; },
    async putBatch(id, createdAt, rows) {
      if (puts++ === failAt) throw new Error('연결 끊김');
      if (bytes(rows) > 1024 * 1024) throw new Error('문서가 1MiB 를 넘음');
      batches.push({ id, createdAt, rows: rows as Rows });
    },
  };
  return { remote, batches };
}

async function addRecall(id: string, startedAt: number, cells: number, answered = '13') {
  await db.recallSessions.add({
    id, mode: 'digits', presetName: 'p', stimulus: [], memorizeMs: 1, memorizeUsedMs: 1, recallMs: 1,
    startedAt, correct: 0, wrong: cells, blank: 0,
  });
  await db.recallCells.bulkAdd(Array.from({ length: cells }, (_, i) => ({
    id: `${id}-c${i}`, sessionId: id, index: i, expected: '12', answered, isCorrect: false, errorTags: [],
  })));
}

const ids = (rows: { id: string }[] | undefined) => (rows ?? []).map((r) => r.id).sort();

beforeEach(async () => {
  await Promise.all([db.recallSessions.clear(), db.recallCells.clear(), db.settings.clear()]);
});

describe('동기화 — 회상 칸', () => {
  it('처음 동기화(lastSyncAt 0)에 판과 칸이 모두 올라간다', async () => {
    await addRecall('r1', Date.now() - 60_000, 3);
    const { remote, batches } = memoryRemote();

    const res = await syncOnce(remote);

    expect(batches).toHaveLength(1);
    expect(ids(batches[0].rows.recallSessions)).toEqual(['r1']);
    expect(ids(batches[0].rows.recallCells)).toEqual(['r1-c0', 'r1-c1', 'r1-c2']);
    expect(res.pushed).toBe(4);
  });

  it('동기화한 뒤 새 판을 하면 그 판의 칸만 올라간다', async () => {
    await addRecall('r1', Date.now() - 60_000, 2);
    const { remote, batches } = memoryRemote();
    await syncOnce(remote);

    const { lastSyncAt } = await getSettings();
    expect(lastSyncAt).toBeGreaterThan(0);
    await addRecall('r2', lastSyncAt! + 1, 2);
    await syncOnce(remote);

    expect(batches).toHaveLength(2);
    expect(ids(batches[1].rows.recallSessions)).toEqual(['r2']);
    expect(ids(batches[1].rows.recallCells)).toEqual(['r2-c0', 'r2-c1']);
  });

  it('고치기 전에 동기화한 기기는 옛 칸을 한 번만 되채운다', async () => {
    /* 판은 예전에 올라갔고(startedAt < lastSyncAt) 칸은 한 번도 안 올라간 기기 */
    const before = Date.now() - 3_600_000;
    await addRecall('old', before - 60_000, 2);
    await saveSettings({ lastSyncAt: before });
    const { remote, batches } = memoryRemote();

    await syncOnce(remote);
    expect(batches).toHaveLength(1);
    expect(batches[0].rows.recallSessions).toBeUndefined();
    expect(ids(batches[0].rows.recallCells)).toEqual(['old-c0', 'old-c1']);
    expect((await getSettings()).recallCellsSynced).toBe(true);

    /* 두 번째에는 새 것이 없으니 아무것도 올리지 않는다 */
    const res = await syncOnce(remote);
    expect(res.pushed).toBe(0);
    expect(batches).toHaveLength(1);
  });

  it('다른 기기가 올린 칸을 내려받는다', async () => {
    await addRecall('r1', Date.now() - 60_000, 2);
    const { remote } = memoryRemote();
    await syncOnce(remote);

    /* 같은 방에 새로 들어온 기기 — 이 기기 기록을 비우고 처음부터 */
    await Promise.all([db.recallSessions.clear(), db.recallCells.clear(), db.settings.clear()]);
    const res = await syncOnce(remote);

    expect(res.pulled).toBe(3);
    expect(ids(await db.recallCells.toArray())).toEqual(['r1-c0', 'r1-c1']);
  });
});

describe('동기화 — 큰 기록은 묶음을 나눠 올린다', () => {
  it('나누기: 묶음마다 한도 아래이고, 이어 붙이면 원래 행이 순서대로 다 있다', () => {
    const rows = {
      recallSessions: Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, presetName: '한글 이름' })),
      recallCells: Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, answered: '가나다라마바사' })),
    };
    const parts = splitRows(rows, 2_000);

    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(bytes(p)).toBeLessThanOrEqual(2_000);
    expect(parts.flatMap((p) => p.recallSessions ?? [])).toEqual(rows.recallSessions);
    expect(parts.flatMap((p) => p.recallCells ?? [])).toEqual(rows.recallCells);
  });

  it('나누기: 빈 기록은 묶음이 없고, 작은 기록은 한 묶음 그대로다', () => {
    expect(splitRows({})).toEqual([]);
    const small = { drillAttempts: [{ id: 'a' }] };
    expect(splitRows(small)).toEqual([small]);
  });

  it('칸 1만 개도 한도 아래 묶음들로 빠짐없이 올라가고, 새 기기가 전부 받는다', async () => {
    await addRecall('big', Date.now() - 60_000, 10_000);
    /* 한 묶음이면 Firestore 문서 한도(1MiB)를 넘는 양이어야 이 시험이 뜻이 있다 */
    expect(bytes(await db.recallCells.toArray())).toBeGreaterThan(1024 * 1024);
    const { remote, batches } = memoryRemote();

    const res = await syncOnce(remote);

    expect(batches.length).toBeGreaterThan(1);
    expect(new Set(batches.map((b) => b.id)).size).toBe(batches.length);
    for (const b of batches) expect(bytes(b.rows)).toBeLessThanOrEqual(BATCH_BYTES);
    const cells = batches.flatMap((b) => b.rows.recallCells ?? []);
    expect(cells).toHaveLength(10_000);
    expect(new Set(cells.map((c) => c.id)).size).toBe(10_000);
    expect(ids(batches.flatMap((b) => b.rows.recallSessions ?? []))).toEqual(['big']);
    expect(res.pushed).toBe(10_001);

    /* 같은 방에 새로 들어온 기기 */
    await Promise.all([db.recallSessions.clear(), db.recallCells.clear(), db.settings.clear()]);
    const got = await syncOnce(remote);

    expect(got.pulled).toBe(10_001);
    expect(await db.recallCells.count()).toBe(10_000);
    expect(ids(await db.recallSessions.toArray())).toEqual(['big']);
  }, 60_000);

  it('묶음 일부만 올라가고 끊기면 표시가 남지 않아, 다음번에 전부 다시 올린다', async () => {
    /* fake-indexeddb 는 이미 있는 행을 덮어쓰는 데 행마다 약 10ms 라, 칸 수를 줄이고 칸을 크게 한다 */
    await addRecall('big', Date.now() - 60_000, 100, 'x'.repeat(10_000));
    const { remote, batches } = memoryRemote(1); // 두 번째 묶음에서 끊긴다

    await expect(syncOnce(remote)).rejects.toThrow('연결 끊김');
    expect(batches).toHaveLength(1);
    const s = await getSettings();
    expect(s.lastSyncAt ?? 0).toBe(0);
    expect(s.recallCellsSynced).toBeFalsy();

    await syncOnce(remote);
    await Promise.all([db.recallSessions.clear(), db.recallCells.clear(), db.settings.clear()]);
    await syncOnce(remote);

    expect(await db.recallCells.count()).toBe(100);
    expect(ids(await db.recallSessions.toArray())).toEqual(['big']);
  }, 60_000);
});
