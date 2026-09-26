import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, getSettings, saveSettings } from '../db/db';
import { syncOnce, type Remote } from './engine';

/*
 * 회상 칸은 시각이 없어 '마지막 동기화 뒤' 비교로는 한 번도 올라가지 않았다(2026-09-26 수리).
 * 칸이 판을 따라 올라가는지, 그 전에 동기화한 기기가 옛 칸을 한 번만 되채우는지 본다.
 */

type Rows = Record<string, { id: string }[]>;

/** Firestore 대신 메모리에 담는 창구. 올린 묶음을 그대로 남겨 들여다본다. */
function memoryRemote() {
  const batches: { id: string; createdAt: number; rows: Rows }[] = [];
  const remote: Remote = {
    async getAssets() { return null; },
    async putAssets() {},
    async listBatches(after) { return batches.filter((b) => b.createdAt > after) as never; },
    async putBatch(id, createdAt, rows) { batches.push({ id, createdAt, rows: rows as Rows }); },
  };
  return { remote, batches };
}

async function addRecall(id: string, startedAt: number, cells: number) {
  await db.recallSessions.add({
    id, mode: 'digits', presetName: 'p', stimulus: [], memorizeMs: 1, memorizeUsedMs: 1, recallMs: 1,
    startedAt, correct: 0, wrong: cells, blank: 0,
  });
  await db.recallCells.bulkAdd(Array.from({ length: cells }, (_, i) => ({
    id: `${id}-c${i}`, sessionId: id, index: i, expected: '12', answered: '13', isCorrect: false, errorTags: [],
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
