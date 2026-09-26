import { db, getSettings, saveSettings } from '../db/db';
import { rebuildAll } from '../db/rebuild';

/**
 * 기기 사이 동기화.
 *
 * 나누는 기준이 하나 있다.
 *  - **자산**(이미지 세트·궁전·설정)은 고쳐지는 것이라 한 덩어리로 주고받고 `updatedAt` 이
 *    늦은 쪽을 남긴다. 기록마다 비교하므로 통째로 덮어쓰지 않는다.
 *  - **기록**(드릴·실전 원시 데이터)은 추가만 되고 id 가 UUID 라 그냥 합치면 된다.
 *    충돌이 아예 없다. 이것이 이 앱에서 동기화가 쉬운 이유다.
 *  - **통계**는 보내지 않는다. 두 기기가 각자 센 횟수를 합치면 숫자가 부푼다.
 *    합친 뒤 각 기기에서 원시 기록으로 다시 계산한다(`rebuildAll`).
 */

export interface SyncResult {
  pushed: number;
  pulled: number;
  assets: 'local' | 'remote' | 'same';
  at: number;
}

/* ── 올릴 것을 모으기 ───────────────────────────── */

const LOG_TABLES = [
  'drillSessions', 'drillAttempts',
  'recallSessions', 'recallCells',
  'mappingSessions', 'mappingAttempts',
  'calcSessions', 'calcItems',
] as const;
type LogTable = (typeof LOG_TABLES)[number];

async function collectAssets() {
  const [imageSets, images, palaces, loci, settings] = await Promise.all([
    db.imageSets.toArray(), db.images.toArray(), db.palaces.toArray(), db.loci.toArray(), getSettings(),
  ]);
  /*
   * lastBackupAt·lastSyncAt·recallCellsSynced 는 기기마다 다른 값이라 보내지 않는다.
   * aiKey 는 **비밀이라** 보내지 않는다 — 기기마다 각자 넣는다.
   */
  const { lastBackupAt: _b, lastSyncAt: _s, recallCellsSynced: _r, aiKey: _k, ...shared } = settings;
  return { imageSets, images, palaces, loci, settings: shared };
}

type AssetBundle = Awaited<ReturnType<typeof collectAssets>>;

/**
 * 기록마다 updatedAt 이 늦은 쪽을 남긴다. 한쪽이 통째로 덮어쓰지 않는다.
 *
 * 다만 갓 켠 기기에는 첫 실행 때 만들어진 **빈 기본 세트**가 있다. 그걸 그대로 합치면
 * 같은 종류의 세트가 두 벌이 되어 통계가 갈라진다. 그래서 '한 칸도 안 채운 기본 세트'는
 * 같은 종류가 저쪽에 있으면 버린다. 회장이 손댄 세트는 절대 버리지 않는다.
 */
export function mergeAssets(local: AssetBundle, remote: AssetBundle): AssetBundle {
  const namedBySet = new Map<string, number>();
  for (const img of local.images) {
    if (img.name.trim()) namedBySet.set(img.setId, (namedBySet.get(img.setId) ?? 0) + 1);
  }
  const remoteDomains = new Set(remote.imageSets.map((s) => s.domain));
  const dropped = new Set(
    local.imageSets
      .filter((s) => s.builtin && !namedBySet.get(s.id) && remoteDomains.has(s.domain))
      .map((s) => s.id),
  );
  if (dropped.size) {
    local = {
      ...local,
      imageSets: local.imageSets.filter((s) => !dropped.has(s.id)),
      images: local.images.filter((i) => !dropped.has(i.setId)),
    };
  }

  const pick = <T extends { id: string; updatedAt?: number }>(a: T[], b: T[]): T[] => {
    const m = new Map<string, T>();
    for (const row of [...a, ...b]) {
      const cur = m.get(row.id);
      if (!cur || (row.updatedAt ?? 0) >= (cur.updatedAt ?? 0)) m.set(row.id, row);
    }
    return [...m.values()];
  };
  return {
    imageSets: pick(local.imageSets, remote.imageSets),
    images: pick(local.images, remote.images),
    palaces: pick(local.palaces, remote.palaces),
    /* 장소는 updatedAt 이 없다. 장소가 더 많은 쪽을 통째로 택한다 — 순서가 섞이면 궁전이 망가진다 */
    loci: remote.loci.length > local.loci.length ? remote.loci : local.loci,
    settings: local.settings,
  };
}

async function applyAssets(b: AssetBundle) {
  await db.transaction('rw', db.imageSets, db.images, db.imageStats, db.palaces, db.loci, async () => {
    /* 합친 결과에 없는 세트는 이 기기에서도 치운다 (갓 켠 기기의 빈 기본 세트) */
    const keep = new Set(b.imageSets.map((s) => s.id));
    const stale = (await db.imageSets.toArray()).filter((s) => !keep.has(s.id)).map((s) => s.id);
    if (stale.length) {
      const staleImages = (await db.images.toArray()).filter((i) => stale.includes(i.setId)).map((i) => i.id);
      await db.images.bulkDelete(staleImages);
      await db.imageStats.bulkDelete(staleImages);
      await db.imageSets.bulkDelete(stale);
    }
    if (b.imageSets.length) await db.imageSets.bulkPut(b.imageSets);
    if (b.images.length) await db.images.bulkPut(b.images);
    if (b.palaces.length) await db.palaces.bulkPut(b.palaces);
    if (b.loci.length) {
      await db.loci.clear();
      await db.loci.bulkAdd(b.loci);
    }
  });
}

/* ── 기록 ───────────────────────────────────────── */

/**
 * `allCells` 는 회상 칸을 시각과 상관없이 전부 올린다 — 칸을 한 번도 올리지 않은 기기의 되채우기.
 */
async function collectLogsSince(since: number, allCells = false) {
  const out: Partial<Record<LogTable, unknown[]>> = {};
  let count = 0;
  const put = (name: LogTable, rows: unknown[]) => {
    if (rows.length) { out[name] = rows; count += rows.length; }
  };
  for (const name of LOG_TABLES) {
    if (name === 'recallCells') continue;
    put(name, (await db.table(name).toArray()).filter((r: Record<string, unknown>) => {
      const t = (r.shownAt ?? r.startedAt ?? 0) as number;
      return t > since;
    }));
  }
  /*
   * 회상 칸에는 시각이 없다. 그래서 칸은 **판을 따라** 간다 — 이번에 올리는 판의 칸만.
   * 판과 칸은 한 트랜잭션에 같이 저장되므로 어긋나지 않는다(Practice.tsx).
   * 칸 표에 시각을 더하지 말 것 — 옛 칸에는 여전히 없어 같은 구멍이 남는다.
   */
  const sessionIds = ((out.recallSessions ?? []) as { id: string }[]).map((s) => s.id);
  put('recallCells', allCells
    ? await db.recallCells.toArray()
    : await db.recallCells.where('sessionId').anyOf(sessionIds).toArray());
  return { rows: out, count };
}

/** id 가 UUID 라 bulkPut 은 몇 번 해도 같은 결과가 된다. */
async function applyLogs(rows: Partial<Record<LogTable, unknown[]>>): Promise<number> {
  let n = 0;
  for (const name of LOG_TABLES) {
    const list = rows[name];
    if (!list?.length) continue;
    await db.table(name).bulkPut(list as never[]);
    n += list.length;
  }
  return n;
}

/* ── 원격 창구 (Firestore 구현은 firestore.ts 가 준다) ── */

export interface Remote {
  getAssets(): Promise<{ bundle: AssetBundle; updatedAt: number } | null>;
  putAssets(bundle: AssetBundle, updatedAt: number): Promise<void>;
  listBatches(after: number): Promise<{ id: string; createdAt: number; rows: Partial<Record<LogTable, unknown[]>> }[]>;
  putBatch(id: string, createdAt: number, rows: Partial<Record<LogTable, unknown[]>>): Promise<void>;
}

/**
 * 한 번 밀고 당긴다.
 * 순서가 중요하다 — 먼저 내려받아 합치고, 그다음 올린다. 그래야 방금 받은 것이 지워지지 않는다.
 */
export async function syncOnce(remote: Remote): Promise<SyncResult> {
  const settings = await getSettings();
  const since = settings.lastSyncAt ?? 0;
  const now = Date.now();

  /* 1. 기록 내려받기 */
  const batches = await remote.listBatches(since);
  let pulled = 0;
  for (const b of batches) pulled += await applyLogs(b.rows);

  /* 2. 자산 맞추기 */
  const localAssets = await collectAssets();
  const remoteAssets = await remote.getAssets();
  let assets: SyncResult['assets'] = 'same';
  if (remoteAssets) {
    const merged = mergeAssets(localAssets, remoteAssets.bundle);
    await applyAssets(merged);
    assets = JSON.stringify(merged.images) === JSON.stringify(localAssets.images) ? 'same' : 'remote';
    await remote.putAssets(merged, now);
  } else {
    await remote.putAssets(localAssets, now);
    assets = 'local';
  }

  /*
   * 3. 새로 생긴 기록 올리기.
   * 2026-09-26 전에는 회상 칸이 한 번도 올라가지 않았다. 그때 동기화한 기기는 칸을 한 번 전부 올린다.
   */
  const mine = await collectLogsSince(since, !settings.recallCellsSynced);
  if (mine.count > 0) {
    await remote.putBatch(`${now}-${Math.random().toString(36).slice(2, 8)}`, now, mine.rows);
  }

  /* 4. 통계는 받은 게 아니라 여기서 다시 만든다 */
  if (pulled > 0) await rebuildAll();

  await saveSettings({ lastSyncAt: now, recallCellsSynced: true });
  return { pushed: mine.count, pulled, assets, at: now };
}
