import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { confusionPairs, dailyRows, heatmap, mappingCells, movers } from '../db/analytics';
import { mastery } from '../db/mapping';
import { db, type ImageSet } from '../db/db';
import { weeklyMarkdown } from '../lib/markdown';
import { download } from '../lib/io';
import { cardLabel } from '../lib/cards';
import { Btn, Empty, Panel, Stat, fmtMs, fmtPct } from '../components/ui';

export default function Stats() {
  const sets = useLiveQuery(() => db.imageSets.toArray(), [], [] as ImageSet[]);
  const [setId, setSetId] = useState('');
  const [days, setDays] = useState(14);
  const [md, setMd] = useState('');

  const activeSet = sets.find((s) => s.id === setId) ?? sets.find((s) => s.domain === 'digit2') ?? sets[0];

  const cells = useLiveQuery(() => (activeSet ? heatmap(activeSet.id) : Promise.resolve([])), [activeSet?.id], []);
  const rows = useLiveQuery(() => dailyRows(days), [days], []);
  const pairs = useLiveQuery(() => confusionPairs(10), [], []);
  const mv = useLiveQuery(() => movers(5), [], { slowest: [], worst: [] });
  const map1 = useLiveQuery(() => mappingCells(1), [], []);
  const m1 = useLiveQuery(() => mastery(1), []);
  const m2 = useLiveQuery(() => mastery(2), []);

  const measured = useMemo(() => cells.filter((c) => c.attempts > 0), [cells]);
  const maxRt = useMemo(() => Math.max(1, ...measured.map((c) => c.medianRt)), [measured]);
  const minRt = useMemo(() => Math.min(...measured.map((c) => c.medianRt), maxRt), [measured, maxRt]);

  const cols = activeSet?.domain === 'cardFace' ? 3 : activeSet?.domain === 'custom' ? 5 : 10;

  const color = (rt: number, attempts: number, errRate: number) => {
    if (attempts === 0) return 'transparent';
    if (errRate >= 0.34) return `color-mix(in srgb, var(--color-bad) ${40 + errRate * 50}%, var(--color-panel2))`;
    const t = maxRt === minRt ? 0.5 : (rt - minRt) / (maxRt - minRt);
    return `color-mix(in srgb, var(--color-warn) ${Math.round(t * 75)}%, var(--color-good) ${Math.round((1 - t) * 60)}%)`;
  };

  const totals = useMemo(() => {
    const attempts = rows.reduce((s, r) => s + r.attempts, 0);
    const correct = rows.reduce((s, r) => s + r.correct, 0);
    const rts = rows.filter((r) => r.medianRt > 0).map((r) => r.medianRt);
    return {
      attempts, correct,
      accuracy: attempts ? correct / attempts : 0,
      medianRt: rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0,
      practice: rows.reduce((s, r) => s + r.practiceSessions, 0),
    };
  }, [rows]);

  const maxAttempts = Math.max(1, ...rows.map((r) => r.attempts));

  const exportMd = async () => {
    const text = await weeklyMarkdown(7);
    setMd(text);
    download(`memory-weekly-${new Date().toISOString().slice(0, 10)}.md`, text, 'text/markdown;charset=utf-8');
  };

  const label = (key: string) => (activeSet?.domain === 'cardFace' ? cardLabel(key) : key);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label={`최근 ${days}일 시도`} value={totals.attempts} />
        <Stat label="정확도" value={totals.attempts ? fmtPct(totals.accuracy) : '—'} />
        <Stat label="평균 중앙 반응시간" value={fmtMs(totals.medianRt)} />
        <Stat label="실전 세션" value={totals.practice} />
        <Stat label="측정된 이미지" value={`${measured.length}/${cells.length}`} />
      </div>

      {(m1?.attempts || m2?.attempts) ? (
        <Panel title="자음 매핑 숙련도 (초급 1·2단계)">
          <div className="grid grid-cols-5 gap-1 sm:grid-cols-10">
            {map1.map((c) => (
              <div
                key={c.unit}
                title={`${c.unit} · 시도 ${c.attempts} · 정확도 ${fmtPct(c.accuracy)} · ${fmtMs(c.medianRt)}`}
                className="rounded-md border border-line/70 px-1 py-1.5 text-center"
                style={{
                  background: c.attempts === 0
                    ? 'transparent'
                    : c.accuracy < 0.9
                      ? 'color-mix(in srgb, var(--color-bad) 55%, var(--color-panel2))'
                      : `color-mix(in srgb, var(--color-warn) ${Math.round(Math.min(1, c.medianRt / 4000) * 75)}%, var(--color-good) 55%)`,
                }}
              >
                <div className={`tnum text-sm font-semibold ${c.attempts ? 'text-ink' : ''}`}>{c.unit}</div>
                <div className={`tnum text-[10px] ${c.attempts ? 'text-ink/70' : 'text-muted'}`}>
                  {c.attempts ? (c.medianRt / 1000).toFixed(1) : '·'}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="1단계 정확도" value={m1?.attempts ? fmtPct(m1.accuracy) : '—'} sub={`안 본 숫자 ${m1?.unseen ?? 10}개`} />
            <Stat label="1단계 반응" value={fmtMs(m1?.medianRt ?? 0)} />
            <Stat label="2단계 정확도" value={m2?.attempts ? fmtPct(m2.accuracy) : '—'} sub={`안 본 칸 ${m2?.unseen ?? 100}개`} />
            <Stat label="2단계 반응" value={fmtMs(m2?.medianRt ?? 0)} />
          </div>
          <p className="mt-2 text-[11px] text-muted">
            위 칸은 1단계(숫자 한 자리)입니다. 붉은 칸은 아직 틀리는 숫자, 숫자는 중앙 반응시간(초)입니다.
          </p>
        </Panel>
      ) : null}

      <Panel
        title="반응시간 히트맵"
        right={
          <select value={activeSet?.id ?? ''} onChange={(e) => setSetId(e.target.value)} className="text-xs">
            {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        }
      >
        {cells.length === 0 ? (
          <Empty>세트에 이미지가 없습니다.</Empty>
        ) : (
          <>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {cells.map((c) => (
                <div
                  key={c.key}
                  title={`${label(c.key)} ${c.image?.name ?? ''}\n중앙 ${fmtMs(c.medianRt)} · 시도 ${c.attempts} · 오답률 ${fmtPct(c.errRate)}`}
                  className="rounded-md border border-line/70 px-1 py-1 text-center"
                  style={{ background: color(c.medianRt, c.attempts, c.errRate) }}
                >
                  <div className={`tnum text-[10px] ${c.attempts ? 'text-ink/70' : 'text-muted'}`}>{label(c.key)}</div>
                  <div className={`tnum text-[11px] ${c.attempts ? 'text-ink font-medium' : ''}`}>
                    {c.medianRt ? (c.medianRt / 1000).toFixed(1) : c.attempts ? '✕' : '·'}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-4 text-[11px] text-muted">
              <span className="flex items-center gap-1"><i className="inline-block size-3 rounded-sm" style={{ background: 'var(--color-good)' }} /> 빠름</span>
              <span className="flex items-center gap-1"><i className="inline-block size-3 rounded-sm" style={{ background: 'var(--color-warn)' }} /> 느림</span>
              <span className="flex items-center gap-1"><i className="inline-block size-3 rounded-sm" style={{ background: 'var(--color-bad)' }} /> 오답률 34% 이상</span>
              <span>숫자는 중앙 반응시간(초) · ✕ 는 실전 오답만 있고 드릴 기록 없음</span>
            </div>
          </>
        )}
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="혼동 쌍 Top 10">
          {pairs.length === 0 ? (
            <Empty>아직 혼동 기록이 없습니다.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr><th className="py-1 text-left">정답</th><th className="text-left">답한 것</th><th className="text-right">횟수</th><th className="text-right">출처</th></tr>
              </thead>
              <tbody>
                {pairs.map((p, i) => (
                  <tr key={i} className="border-t border-line/60">
                    <td className="tnum py-1">{p.expected}</td>
                    <td className="tnum text-bad">{p.answered}</td>
                    <td className="tnum text-right">{p.count}</td>
                    <td className="text-right text-xs text-muted">{p.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="약점 이미지">
          {mv.slowest.length === 0 && mv.worst.length === 0 ? (
            <Empty>드릴 기록이 쌓이면 나타납니다.</Empty>
          ) : (
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-muted">가장 느림</div>
                {mv.slowest.map((m) => (
                  <div key={m.key} className="flex justify-between border-t border-line/60 py-1">
                    <span className="tnum">{m.key} {m.name}</span>
                    <span className="tnum text-warn">{fmtMs(m.medianRt)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 text-xs text-muted">오답률 높음</div>
                {mv.worst.map((m) => (
                  <div key={m.key} className="flex justify-between border-t border-line/60 py-1">
                    <span className="tnum">{m.key} {m.name}</span>
                    <span className="tnum text-bad">{fmtPct(m.errRate)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="일별 추이"
        right={
          <div className="flex items-center gap-1.5">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="text-xs">
              <option value={7}>7일</option><option value={14}>14일</option><option value={30}>30일</option>
            </select>
            <Btn size="sm" variant="primary" onClick={exportMd}>주간 요약 .md</Btn>
          </div>
        }
      >
        <div className="flex h-32 items-end gap-1">
          {rows.map((r) => (
            <div key={r.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${r.day}\n시도 ${r.attempts} · 정확도 ${r.attempts ? fmtPct(r.accuracy) : '—'} · 중앙 ${fmtMs(r.medianRt)}`}>
              <div className="w-full rounded-t bg-accent/70" style={{ height: `${(r.attempts / maxAttempts) * 100}%` }} />
              <span className="text-[9px] text-muted">{r.day.slice(5)}</span>
            </div>
          ))}
        </div>
        {md && (
          <textarea readOnly value={md} className="mt-3 h-40 w-full font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        )}
      </Panel>
    </div>
  );
}
