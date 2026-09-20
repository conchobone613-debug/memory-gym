import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Locus, type Palace } from '../db/db';
import { uid } from '../lib/random';
import { isTyping } from '../App';
import { Btn, ConfirmBtn, Empty, Panel } from '../components/ui';

export default function Palaces() {
  const palaces = useLiveQuery(() => db.palaces.toArray(), [], [] as Palace[]);
  const [palaceId, setPalaceId] = useState('');
  const [newLocus, setNewLocus] = useState('');
  const [newPalace, setNewPalace] = useState('');
  const [walk, setWalk] = useState(false);
  const [walkIdx, setWalkIdx] = useState(0);
  const [hidden, setHidden] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);

  const loci = useLiveQuery(
    async () =>
      palaceId
        ? (await db.loci.where('palaceId').equals(palaceId).toArray()).sort((a, b) => a.order - b.order)
        : [],
    [palaceId],
    [] as Locus[],
  );

  useEffect(() => {
    if (!palaceId && palaces.length) setPalaceId(palaces[0].id);
  }, [palaces, palaceId]);

  const palace = useMemo(() => palaces.find((p) => p.id === palaceId), [palaces, palaceId]);

  const addPalace = async () => {
    const name = newPalace.trim();
    if (!name) return;
    const t = Date.now();
    const id = uid();
    await db.palaces.add({ id, name, note: '', createdAt: t, updatedAt: t });
    setNewPalace('');
    setPalaceId(id);
  };

  const removePalace = async () => {
    if (!palace) return;
    await db.transaction('rw', db.palaces, db.loci, async () => {
      await db.loci.bulkDelete(loci.map((l) => l.id));
      await db.palaces.delete(palace.id);
    });
    setPalaceId('');
  };

  const addLocus = async () => {
    const name = newLocus.trim();
    if (!name || !palaceId) return;
    await db.loci.add({ id: uid(), palaceId, order: loci.length, name, note: '' });
    setNewLocus('');
    addRef.current?.focus();
  };

  const moveLocus = async (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= loci.length) return;
    const a = loci[index], b = loci[to];
    await db.transaction('rw', db.loci, async () => {
      await db.loci.update(a.id, { order: b.order });
      await db.loci.update(b.id, { order: a.order });
    });
  };

  const removeLocus = async (l: Locus) => {
    await db.transaction('rw', db.loci, async () => {
      await db.loci.delete(l.id);
      const rest = (await db.loci.where('palaceId').equals(palaceId).toArray()).sort((x, y) => x.order - y.order);
      for (let i = 0; i < rest.length; i++) await db.loci.update(rest[i].id, { order: i });
    });
  };

  /* 워크스루 단축키 */
  useEffect(() => {
    if (!walk) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === 'Escape') { e.preventDefault(); setWalk(false); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); setWalkIdx((i) => Math.min(loci.length - 1, i + 1)); setHidden(false); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setWalkIdx((i) => Math.max(0, i - 1)); setHidden(false); }
      else if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); setHidden((h) => !h); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [walk, loci.length]);

  if (walk && palace) {
    const l = loci[walkIdx];
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{palace.name} — {walkIdx + 1} / {loci.length}</span>
          <Btn size="sm" onClick={() => setWalk(false)}>나가기 (Esc)</Btn>
        </div>
        <div
          className="flex min-h-[20rem] cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border border-line bg-panel"
          onClick={() => setHidden((h) => !h)}
        >
          <span className="tnum text-sm text-muted">{walkIdx + 1}번 장소</span>
          <div className="text-4xl font-semibold">{hidden ? '● ● ●' : l?.name}</div>
          {!hidden && l?.note && <div className="text-sm text-muted">{l.note}</div>}
          <p className="text-xs text-muted">
            <kbd>Space</kbd> 가리기 · <kbd>→</kbd> 다음 · <kbd>←</kbd> 이전
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
      <Panel title="궁전">
        <div className="mb-3 flex gap-1.5">
          <input
            value={newPalace}
            onChange={(e) => setNewPalace(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPalace(); } }}
            placeholder="새 궁전 이름 + Enter"
            className="min-w-0 flex-1"
          />
          <Btn size="sm" onClick={addPalace}>추가</Btn>
        </div>
        {palaces.length === 0 ? (
          <Empty>궁전이 없습니다.</Empty>
        ) : (
          <ul className="flex flex-col gap-1">
            {palaces.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setPalaceId(p.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                    p.id === palaceId ? 'border-accent bg-accent/15' : 'border-line bg-panel2'
                  }`}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {palace ? (
        <Panel
          title={
            <input
              key={palace.id}
              defaultValue={palace.name}
              onBlur={(e) =>
                e.target.value.trim() && db.palaces.update(palace.id, { name: e.target.value.trim(), updatedAt: Date.now() })
              }
              className="w-48 text-sm font-semibold"
            />
          }
          right={
            <div className="flex flex-wrap gap-1.5">
              <span className="self-center text-xs text-muted">장소 {loci.length}개</span>
              <Btn size="sm" variant="primary" disabled={loci.length === 0}
                onClick={() => { setWalk(true); setWalkIdx(0); setHidden(false); }}>
                워크스루
              </Btn>
              <ConfirmBtn
                size="sm"
                label="삭제"
                confirmLabel={`'${palace.name}' 과 장소 ${loci.length}개가 사라집니다`}
                onConfirm={removePalace}
              />
            </div>
          }
        >
          <div className="mb-3 flex gap-2">
            <input
              ref={addRef}
              value={newLocus}
              onChange={(e) => setNewLocus(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLocus(); } }}
              placeholder="장소 이름 + Enter (예: 현관 신발장)"
              className="flex-1"
            />
            <Btn onClick={addLocus}>추가</Btn>
          </div>
          {loci.length === 0 ? (
            <Empty>장소를 순서대로 추가하십시오.</Empty>
          ) : (
            <ul className="flex flex-col gap-1">
              {loci.map((l, i) => (
                <li key={l.id} className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-2 py-1.5">
                  <span className="tnum w-7 text-center text-xs text-muted">{i + 1}</span>
                  <input
                    defaultValue={l.name}
                    onBlur={(e) => db.loci.update(l.id, { name: e.target.value })}
                    className="flex-1"
                  />
                  <input
                    defaultValue={l.note}
                    onBlur={(e) => db.loci.update(l.id, { note: e.target.value })}
                    placeholder="메모"
                    className="w-40"
                  />
                  <Btn size="sm" onClick={() => moveLocus(i, -1)} disabled={i === 0}>↑</Btn>
                  <Btn size="sm" onClick={() => moveLocus(i, 1)} disabled={i === loci.length - 1}>↓</Btn>
                  <Btn size="sm" variant="danger" onClick={() => removeLocus(l)}>삭제</Btn>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <Panel><Empty>왼쪽에서 궁전을 고르시거나 새로 만드십시오.</Empty></Panel>
      )}
    </div>
  );
}
