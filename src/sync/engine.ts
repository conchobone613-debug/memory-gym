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
  const { lastBackupAt: _b, lastSyncAt: _s, recallCellsSynced: _r, aiKey: _k, syncTombstones, ...shared } = settings;
  /* 지운 것의 id → 지운 때. 옛 기기가 올린 묶음엔 없을 수 있다. */
  const deleted: Record<string, number> = syncTombstones ?? {};
  return { imageSets, images, palaces, loci, settings: shared, deleted };
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

  /* 지운 표시는 양쪽 것을 합친다. 지운 뒤 다시 고친 행(updatedAt 이 더 늦음)은 살린다. */
  const deleted: Record<string, number> = { ...(remote.deleted ?? {}) };
  for (const [id, t] of Object.entries(local.deleted ?? {})) deleted[id] = Math.max(t, deleted[id] ?? 0);
  const alive = (row: { id: string; updatedAt?: number }) => !(deleted[row.id] >= (row.updatedAt ?? 0));

  /*
   * 행마다 updatedAt 이 늦은 쪽. 같으면 저쪽 것 — 그래야 두 기기가 같은 결과로 모인다.
   */
  const pick = <T extends { id: string; updatedAt?: number }>(a: T[], b: T[]): T[] => {
    const m = new Map<string, T>();
    for (const row of [...a, ...b]) {
      const cur = m.get(row.id);
      if (!cur || (row.updatedAt ?? 0) >= (cur.updatedAt ?? 0)) m.set(row.id, row);
    }
    return [...m.values()].filter(alive);
  };
  const imageSets = pick(local.imageSets, remote.imageSets);
  const setIds = new Set(imageSets.map((x) => x.id));
  const palaces = pick(local.palaces, remote.palaces);
  const palaceIds = new Set(palaces.map((x) => x.id));
  return {
    imageSets,
    images: pick(local.images, remote.images).filter((x) => setIds.has(x.setId)),
    palaces,
    /* 장소도 행마다 고른다(2026-10-06 전엔 '많은 쪽 통째로' — 지운 장소가 되살아났다) */
    loci: pick(local.loci, remote.loci).filter((x) => palaceIds.has(x.palaceId)),
    settings: local.settings,
    deleted,
  };
}

/**
 * 설정을 뺀 나머지가 같은지 — 행 순서는 보지 않는다.
 * 설정은 이 기기 것을 보낼 뿐 합치지 않으므로 비교에서 뺀다.
 */
export function sameAssets(a: AssetBundle, b: AssetBundle): boolean {
  const rows = (l: { id: string }[]) => l.map((r) => JSON.stringify(r)).sort();
  const body = (x: AssetBundle) => JSON.stringify([
    rows(x.imageSets), rows(x.images), rows(x.palaces), rows(x.loci),
    Object.entries(x.deleted ?? {}).sort(),
  ]);
  return body(a) === body(b);
}

async function applyAssets(b: AssetBundle) {
  await db.transaction('rw', db.imageSets, db.images, db.imageStats, db.palaces, db.loci, async () => {
    /* 합친 결과에 없는 것은 이 기기에서도 치운다 (갓 켠 기기의 빈 기본 세트, 다른 기기에서 지운 것) */
    const keepSets = new Set(b.imageSets.map((s) => s.id));
    const keepImages = new Set(b.images.map((i) => i.id));
    const staleImages = (await db.images.toArray()).filter((i) => !keepImages.has(i.id)).map((i) => i.id);
    await db.images.bulkDelete(staleImages);
    await db.imageStats.bulkDelete(staleImages);
    await db.imageSets.bulkDelete((await db.imageSets.toArray()).filter((s) => !keepSets.has(s.id)).map((s) => s.id));
    const keepPalaces = new Set(b.palaces.map((p) => p.id));
    await db.palaces.bulkDelete((await db.palaces.toArray()).filter((p) => !keepPalaces.has(p.id)).map((p) => p.id));
    if (b.imageSets.length) await db.imageSets.bulkPut(b.imageSets);
    if (b.images.length) await db.images.bulkPut(b.images);
    if (b.palaces.length) await db.palaces.bulkPut(b.palaces);
    await db.loci.clear();
    if (b.loci.length) await db.loci.bulkAdd(b.loci);
  });
  await saveSettings({ syncTombstones: b.deleted });
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

type LogRows = Partial<Record<LogTable, unknown[]>>;

/** 묶음 하나의 JSON 크기 상한. Firestore 문서 한도가 1MiB 라 여유를 둔다. */
export const BATCH_BYTES = 700_000;

const utf8 = new TextEncoder();

/**
 * 올릴 기록을 JSON 크기(UTF-8 바이트) 기준으로 여러 묶음으로 나눈다. 행 순서는 그대로다.
 * 한 행이 상한을 넘는 일은 없다고 본다 — 넘으면 그 행 혼자 한 묶음이 된다.
 */
export function splitRows(rows: LogRows, limit = BATCH_BYTES): LogRows[] {
  const out: LogRows[] = [];
  let cur: LogRows = {};
  let size = 2; // {}
  for (const name of LOG_TABLES) {
    const head = name.length + 6; // "이름":[] 와 쉼표
    for (const row of rows[name] ?? []) {
      const add = utf8.encode(JSON.stringify(row)).length + 1;
      if (size > 2 && size + (cur[name] ? 0 : head) + add > limit) {
        out.push(cur);
        cur = {};
        size = 2;
      }
      if (!cur[name]) { cur[name] = []; size += head; }
      cur[name].push(row);
      size += add;
    }
  }
  if (size > 2) out.push(cur);
  return out;
}

/** id 가 UUID 라 bulkPut 은 몇 번 해도 같은 결과가 된다. */
async function applyLogs(rows: Partial<Record<LogTable, unknown[]>>): Promise<number> {
  let n = 0;
  for (const name of LOG_TABLES) {
    const list = rows[name] as { id: string }[] | undefined;
    if (!list?.length) continue;
    /* 이미 가진 기록은 세지 않는다 — 겹쳐 받는 구간(PULL_OVERLAP)이 있어서다 */
    const have = await db.table(name).bulkGet(list.map((r) => r.id));
    const fresh = list.filter((_, i) => !have[i]);
    if (fresh.length) await db.table(name).bulkPut(fresh as never[]);
    n += fresh.length;
  }
  return n;
}

/**
 * 내려받을 때 마지막 동기화보다 이만큼 앞부터 다시 훑는다.
 * 묶음의 시각은 올린 기기가 '올리기 시작한 때'라, 저쪽이 올리는 도중에 이쪽이 맞추면
 * 그 묶음이 이쪽 lastSyncAt 보다 앞 시각으로 늦게 도착한다. 기기 시계 차이도 여기서 덮는다.
 */
export const PULL_OVERLAP = 10 * 60_000;

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
  const batches = await remote.listBatches(since ? since - PULL_OVERLAP : 0);
  let pulled = 0;
  for (const b of batches) pulled += await applyLogs(b.rows);

  /* 2. 자산 맞추기 */
  const localAssets = await collectAssets();
  const remoteAssets = await remote.getAssets();
  let assets: SyncResult['assets'] = 'same';
  if (remoteAssets) {
    const merged = mergeAssets(localAssets, remoteAssets.bundle);
    /*
     * 바뀐 쪽에만 쓴다. 자동 동기화에서 이게 빠지면 두 기기가 서로의 쓰기에 깨어나
     * 끝없이 주고받는다.
     */
    if (!sameAssets(merged, localAssets)) { await applyAssets(merged); assets = 'remote'; }
    if (!sameAssets(merged, remoteAssets.bundle)) await remote.putAssets(merged, now);
  } else {
    await remote.putAssets(localAssets, now);
    assets = 'local';
  }

  /*
   * 3. 새로 생긴 기록 올리기.
   * 2026-09-26 전에는 회상 칸이 한 번도 올라가지 않았다. 그때 동기화한 기기는 칸을 한 번 전부 올린다.
   * 첫 동기화·되채우기는 Firestore 문서 한도(1MiB)를 넘을 수 있어 묶음을 나눠 올린다.
   * 중간에 실패하면 lastSyncAt 이 그대로라 다음번에 전부 다시 올린다 — 받는 쪽 bulkPut 은 겹쳐도 같다.
   */
  const mine = await collectLogsSince(since, !settings.recallCellsSynced);
  const tag = Math.random().toString(36).slice(2, 8);
  for (const [i, rows] of splitRows(mine.rows).entries()) {
    await remote.putBatch(`${now}-${tag}-${i}`, now, rows);
  }

  /* 4. 통계는 받은 게 아니라 여기서 다시 만든다 */
  if (pulled > 0) await rebuildAll();

  await saveSettings({ lastSyncAt: now, recallCellsSynced: true });
  return { pushed: mine.count, pulled, assets, at: now };
}
