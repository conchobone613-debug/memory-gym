import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { blankImage, db, markDeleted } from '../db/db';
import { mergeAssets, sameAssets, syncOnce, type Remote } from './engine';

/*
 * 자동 동기화(2026-10-06)의 두 조건을 본다.
 *  1. 두 기기가 서로의 쓰기에 깨어나도 끝없이 주고받지 않는다 — 바뀐 게 없으면 쓰지 않는다.
 *  2. 지운 세트·궁전·장소가 다른 기기 것과 합쳐질 때 되살아나지 않는다.
 */

type Bundle = Parameters<typeof mergeAssets>[0];

const set = (id: string, updatedAt = 1) =>
  ({ id, name: id, domain: 'digit2', builtin: false, createdAt: 1, updatedAt }) as Bundle['imageSets'][number];
const img = (id: string, setId: string, name: string, updatedAt: number) =>
  ({ ...blankImage(setId, id), id, name, updatedAt }) as Bundle['images'][number];
const palace = (id: string) => ({ id, name: id, note: '', createdAt: 1, updatedAt: 1 });
const locus = (id: string, palaceId: string, order: number, name = id, updatedAt?: number) =>
  ({ id, palaceId, order, name, note: '', updatedAt });

const bundle = (p: Partial<Bundle>): Bundle =>
  ({ imageSets: [], images: [], palaces: [], loci: [], settings: {} as Bundle['settings'], deleted: {}, ...p });

/** Firestore 대신 메모리. 자산을 몇 번 썼는지 센다. */
function memoryRemote(initial: Bundle | null) {
  let assets = initial ? { bundle: initial, updatedAt: 1 } : null;
  let writes = 0;
  const remote: Remote = {
    async getAssets() { return assets && { bundle: JSON.parse(JSON.stringify(assets.bundle)), updatedAt: assets.updatedAt }; },
    async putAssets(b, t) { writes++; assets = { bundle: JSON.parse(JSON.stringify(b)), updatedAt: t }; },
    async listBatches() { return []; },
    async putBatch() {},
  };
  return { remote, writes: () => writes, assets: () => assets?.bundle };
}

beforeEach(async () => {
  await Promise.all([db.imageSets.clear(), db.images.clear(), db.palaces.clear(), db.loci.clear(), db.settings.clear()]);
});

describe('자산 합치기 — 두 기기가 같은 결과로 모인다', () => {
  it('각자 고친 이미지는 늦은 쪽이 이기고, 양쪽에서 합쳐도 같은 결과다', () => {
    const a = bundle({ imageSets: [set('s')], images: [img('i1', 's', '집에서', 20), img('i2', 's', '옛', 1)] });
    const b = bundle({ imageSets: [set('s')], images: [img('i1', 's', '옛', 1), img('i2', 's', '진료실에서', 30)] });
    const ab = mergeAssets(a, b);
    const ba = mergeAssets(b, a);
    expect(sameAssets(ab, ba)).toBe(true);
    expect(ab.images.map((i) => i.name).sort()).toEqual(['진료실에서', '집에서']);
  });

  it('지운 세트는 저쪽에 남아 있어도 되살아나지 않고, 그 이미지도 따라 사라진다', () => {
    const here = bundle({ deleted: { s: 50, i1: 50 } });
    const there = bundle({ imageSets: [set('s', 10)], images: [img('i1', 's', '이름', 10)] });
    for (const m of [mergeAssets(here, there), mergeAssets(there, here)]) {
      expect(m.imageSets).toEqual([]);
      expect(m.images).toEqual([]);
      expect(m.deleted.s).toBe(50);
    }
  });

  it('지운 궁전의 장소, 지운 장소 하나도 되살아나지 않는다', () => {
    const here = bundle({ palaces: [palace('p1')], loci: [locus('l1', 'p1', 0)], deleted: { p2: 50, l2: 50, l3: 50 } });
    const there = bundle({
      palaces: [palace('p1'), palace('p2')],
      loci: [locus('l1', 'p1', 0), locus('l2', 'p1', 1), locus('l3', 'p2', 0)],
    });
    const m = mergeAssets(here, there);
    expect(m.palaces.map((p) => p.id)).toEqual(['p1']);
    expect(m.loci.map((l) => l.id)).toEqual(['l1']);
  });

  it('장소 이름을 고치면 장소 수가 같아도 고친 쪽이 이긴다', () => {
    const here = bundle({ palaces: [palace('p1')], loci: [locus('l1', 'p1', 0, '현관', 40)] });
    const there = bundle({ palaces: [palace('p1')], loci: [locus('l1', 'p1', 0, 'l1')] });
    expect(mergeAssets(here, there).loci[0].name).toBe('현관');
    expect(mergeAssets(there, here).loci[0].name).toBe('현관');
  });
});

describe('자동 동기화 — 바뀐 게 없으면 쓰지 않는다', () => {
  it('저쪽과 같으면 자산을 쓰지 않는다 (서로 깨워도 멈춘다)', async () => {
    await db.imageSets.add(set('s'));
    await db.images.add(img('i1', 's', '이름', 5));
    const r = memoryRemote(null);
    await syncOnce(r.remote);
    expect(r.writes()).toBe(1);

    await syncOnce(r.remote);
    await syncOnce(r.remote);
    expect(r.writes()).toBe(1);
  });

  it('이 기기에서 고치면 한 번 쓰고, 다른 기기 것을 받으면 이 기기에 들어간다', async () => {
    await db.imageSets.add(set('s'));
    await db.images.add(img('i1', 's', '옛', 5));
    const r = memoryRemote(null);
    await syncOnce(r.remote);

    await db.images.put(img('i1', 's', '새 이름', 10));
    await syncOnce(r.remote);
    expect(r.writes()).toBe(2);
    expect(r.assets()!.images[0].name).toBe('새 이름');

    /* 다른 기기가 더 늦게 고친 것 */
    await r.remote.putAssets(bundle({ ...r.assets()!, images: [img('i1', 's', '진료실', 99)] }), 2);
    await syncOnce(r.remote);
    expect((await db.images.get('i1'))!.name).toBe('진료실');
    expect(r.writes()).toBe(3); // 위 putAssets 한 번. syncOnce 는 쓰지 않았다
  });

  it('이 기기에서 지운 세트를 저쪽 것이 되살리지 않는다', async () => {
    await db.imageSets.add(set('s'));
    await db.images.add(img('i1', 's', '이름', 5));
    const r = memoryRemote(null);
    await syncOnce(r.remote);

    await db.images.delete('i1');
    await db.imageSets.delete('s');
    await markDeleted(['s', 'i1']);
    await syncOnce(r.remote);

    expect(await db.imageSets.count()).toBe(0);
    expect(r.assets()!.imageSets).toEqual([]);
    expect(r.assets()!.deleted.s).toBeGreaterThan(0);
  });
});
