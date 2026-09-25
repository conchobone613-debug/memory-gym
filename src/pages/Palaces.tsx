import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Locus, type Palace } from '../db/db';
import { uid } from '../lib/random';
import { isTyping } from '../App';
import { ConfirmBtn, Empty, Field } from '../components/ui';
import { Dymo, Folder, Hud, IndexCard, Key, pressVisual } from '../components/lp';

export default function Palaces() {
  const palaces = useLiveQuery(() => db.palaces.toArray(), [], [] as Palace[]);
  /* 궁전 목록 카드에 장소 수와 첫·끝 장소를 적으려고 장소 전체를 읽고, 고른 궁전의 장소는 여기서 거른다. */
  const allLoci = useLiveQuery(() => db.loci.toArray(), [], [] as Locus[]);
  const [palaceId, setPalaceId] = useState('');
  const [newLocus, setNewLocus] = useState('');
  const [newPalace, setNewPalace] = useState('');
  const [walk, setWalk] = useState(false);
  const [walkIdx, setWalkIdx] = useState(0);
  const [hidden, setHidden] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  const walkRef = useRef<HTMLDivElement>(null);

  const lociOf = (id: string) => allLoci.filter((l) => l.palaceId === id).sort((a, b) => a.order - b.order);
  const loci = useMemo(() => lociOf(palaceId), [allLoci, palaceId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /* 워크스루 한 걸음 — 자판과 단축키가 같은 길로 간다 */
  const step = (d: number) => {
    setWalkIdx((i) => Math.min(loci.length - 1, Math.max(0, i + d)));
    setHidden(false);
  };
  /* 단축키로 불러도 그 자판이 눌린 것처럼 보이고 같은 소리가 난다(더 갈 곳이 없어 잠긴 자판은 조용히) */
  const press = (name: string) => {
    const el = walkRef.current?.querySelector<HTMLButtonElement>(`[data-walk="${name}"]`);
    if (el && !el.disabled) pressVisual(el);
  };

  /* 워크스루 단축키 */
  useEffect(() => {
    if (!walk) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === 'Escape') { e.preventDefault(); setWalk(false); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); press('next'); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); press('prev'); step(-1); }
      else if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); press('hide'); setHidden((h) => !h); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [walk, loci.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (walk && palace) {
    const l = loci[walkIdx];
    /* 자판을 눌러도 포커스를 가져가지 않는다 — 그래야 이어서 누르는 Enter·Space 가 단축키로만 간다. */
    const keepFocus = (e: React.MouseEvent) => e.preventDefault();
    return (
      <div ref={walkRef} className="flex flex-col gap-4">
        <Hud
          left={<>{palace.name} · <b>{walkIdx + 1}</b>/{loci.length}</>}
          right={<Key tone="cream" size="sm" onMouseDown={keepFocus} onClick={() => setWalk(false)}>나가기</Key>}
        />
        <div
          className="lp-panel flex min-h-[18rem] cursor-pointer select-none flex-col items-center justify-center gap-4 px-5 py-8 text-center"
          onClick={() => setHidden((h) => !h)}
        >
          <span className="tnum text-[14px] font-bold text-ink-2">{walkIdx + 1}번 장소</span>
          <span className="font-sign text-[40px] leading-[1.1] break-keep [overflow-wrap:anywhere] text-ink">{hidden ? '● ● ●' : l?.name}</span>
          {!hidden && l?.note && <span className="font-body text-[15px] leading-[1.5] text-ink-2">{l.note}</span>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Key tone="cream" data-walk="prev" sub="←" disabled={walkIdx === 0} onMouseDown={keepFocus} onClick={() => step(-1)}>
            앞 장소
          </Key>
          <Key tone="cream" data-walk="hide" sub="Space" onMouseDown={keepFocus} onClick={() => setHidden((h) => !h)}>
            {hidden ? '보이기' : '가리기'}
          </Key>
        </div>
        <Key
          tone="red"
          size="big"
          data-walk="next"
          sub="→ · Enter"
          disabled={walkIdx >= loci.length - 1}
          onMouseDown={keepFocus}
          onClick={() => step(1)}
        >
          다음 장소
        </Key>
        <p className="m-0 text-center font-typek text-[11px] text-ink-2">카드를 누르면 가리고 보입니다 · Esc 나가기</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="m-0 font-sign text-[40px] leading-none text-ink">궁전</h1>
        <p className="m-0 mt-1.5 font-typek text-[12px] font-bold text-ink-2">외운 이미지를 놓아 둘 자리 · 순서가 있는 길</p>
      </header>

      <span><Dymo small>궁전 목록</Dymo></span>
      {palaces.length === 0 ? (
        <Empty>궁전이 없습니다. 아래에 이름을 넣어 만드십시오.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {palaces.map((p) => {
            const mine = lociOf(p.id);
            const n = mine.length;
            return (
              <IndexCard
                key={p.id}
                title={p.name}
                meta={`${n}곳`}
                body={n === 0 ? '장소가 아직 없습니다' : n === 1 ? mine[0].name : `${mine[0].name} → ${mine[n - 1].name}`}
                onClick={() => setPalaceId(p.id)}
                /* 고른 궁전은 테두리 선으로(색에만 기대지 않는다) */
                className={p.id === palaceId ? 'outline-2 outline-offset-2 outline-ink' : undefined}
              />
            );
          })}
        </div>
      )}

      <div className="flex gap-2.5">
        <input
          value={newPalace}
          onChange={(e) => setNewPalace(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPalace(); } }}
          placeholder="새 궁전 이름 + Enter"
          aria-label="새 궁전 이름"
          className="min-w-0 flex-1"
        />
        <Key tone="cream" size="sm" onClick={addPalace}>추가</Key>
      </div>

      {palace && (
        <Folder tab="궁전 편집">
          <Field label="궁전 이름">
            <input
              key={palace.id}
              defaultValue={palace.name}
              onBlur={(e) =>
                e.target.value.trim() && db.palaces.update(palace.id, { name: e.target.value.trim(), updatedAt: Date.now() })
              }
            />
          </Field>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Key tone="red" disabled={loci.length === 0} onClick={() => { setWalk(true); setWalkIdx(0); setHidden(false); }}>
              워크스루
            </Key>
            <ConfirmBtn
              size="sm"
              label="궁전 삭제"
              confirmLabel={`'${palace.name}' 과 장소 ${loci.length}개가 사라집니다`}
              onConfirm={removePalace}
            />
          </div>

          <div className="mt-5 mb-2 font-typek text-[12px] font-bold text-ink-2">
            장소 <span className="tnum text-ink">{loci.length}</span>곳 · 걸어가는 순서대로
          </div>
          <div className="flex gap-2.5">
            <input
              ref={addRef}
              value={newLocus}
              onChange={(e) => setNewLocus(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLocus(); } }}
              placeholder="장소 이름 + Enter (예: 현관 신발장)"
              aria-label="새 장소 이름"
              className="min-w-0 flex-1"
            />
            <Key tone="cream" size="sm" onClick={addLocus}>추가</Key>
          </div>

          {loci.length === 0 ? (
            <Empty>장소를 순서대로 추가하십시오.</Empty>
          ) : (
            /* 장소 한 줄 = 타자기 번호 + 이름(첫 줄) · 메모(둘째 줄). 순서 바꾸기·지우기는 오른쪽 자판. */
            <ol className="m-0 mt-3 flex list-none flex-col p-0">
              {loci.map((l, i) => (
                <li
                  key={l.id}
                  className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2.5 border-b border-dashed border-manila-dark py-3 last:border-b-0"
                >
                  <span className="tnum row-span-2 self-start pt-1.5 text-right text-[16px] font-bold text-ink">{i + 1}</span>
                  <input
                    defaultValue={l.name}
                    onBlur={(e) => db.loci.update(l.id, { name: e.target.value })}
                    aria-label={`${i + 1}번 장소 이름`}
                    className="w-full"
                  />
                  <span className="flex gap-2">
                    <Key tone="cream" size="sm" aria-label="위로" onClick={() => moveLocus(i, -1)} disabled={i === 0}>↑</Key>
                    <Key tone="cream" size="sm" aria-label="아래로" onClick={() => moveLocus(i, 1)} disabled={i === loci.length - 1}>↓</Key>
                  </span>
                  <input
                    defaultValue={l.note}
                    onBlur={(e) => db.loci.update(l.id, { note: e.target.value })}
                    placeholder="메모"
                    aria-label={`${i + 1}번 장소 메모`}
                    className="w-full"
                  />
                  <Key tone="cream" size="sm" className="is-danger justify-self-end" onClick={() => removeLocus(l)}>삭제</Key>
                </li>
              ))}
            </ol>
          )}
        </Folder>
      )}
    </div>
  );
}
