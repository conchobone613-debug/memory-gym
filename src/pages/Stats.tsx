import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { confusionPairs, dailyRows, heatmap, mappingCells, movers } from '../db/analytics';
import { goalFor } from '../db/goals';
import GoalPanel from '../components/GoalPanel';
import { db, type ImageSet } from '../db/db';
import { weeklyMarkdown } from '../lib/markdown';
import { download } from '../lib/io';
import { cardLabel } from '../lib/cards';
import { reduced } from '../design/settings';
import { Dymo, Key } from '../components/lp';
import { Empty, Panel, Stat, fmtMs, fmtPct } from '../components/ui';

/*
 * 기록 — 둘러보는 화면. 칸 색은 종이 팔레트로만 단계를 나눈다:
 * 빠름 = 칠판 초록, 느림 = 먹끈 빨강, 자주 틀림 = 파란 연필. 카드 바탕에 옅게 섞어 위의 글자(ink)가 읽히게 한다.
 */
const tint = (c: string, p = 45) => `color-mix(in srgb, ${c} ${p}%, var(--card))`;
/** t = 0(빠름) ~ 1(느림) */
const speed = (t: number) => tint(`color-mix(in srgb, var(--red) ${Math.round(t * 100)}%, var(--chalk))`);
/** 틀린 비율이 클수록 진한 파랑(35~60%) */
const wrong = (errRate: number) => tint('var(--blue)', Math.round(35 + Math.min(1, errRate) * 25));

const cellBox = 'rounded-[2px] border border-card-edge px-0.5 py-1 text-center';
const caption = 'font-typek text-[11px] leading-relaxed text-ink-2';

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
  const m1 = useLiveQuery(() => goalFor(1), []);
  const m2 = useLiveQuery(() => goalFor(2), []);
  const m3 = useLiveQuery(() => goalFor(3), []);

  const measured = useMemo(() => cells.filter((c) => c.attempts > 0), [cells]);
  const maxRt = useMemo(() => Math.max(1, ...measured.map((c) => c.medianRt)), [measured]);
  const minRt = useMemo(() => Math.min(...measured.map((c) => c.medianRt), maxRt), [measured, maxRt]);

  const cols = activeSet?.domain === 'cardFace' ? 3 : activeSet?.domain === 'custom' ? 5 : 10;

  const color = (rt: number, attempts: number, errRate: number) => {
    if (attempts === 0) return 'transparent';
    if (errRate >= 0.34) return wrong(errRate);
    return speed(maxRt === minRt ? 0.5 : (rt - minRt) / (maxRt - minRt));
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
  /* 휴대폰 폭에 날짜 글자가 겹치지 않게 며칠 걸러 적는다(7일 = 매일, 14일 = 이틀, 30일 = 닷새) */
  const labelStep = Math.ceil(days / 7);

  /* 일별 막대는 처음 화면에 들어올 때 한 번 아래에서 차오른다(transform 만). 움직임 줄이기면 처음부터 끝 상태. */
  const [grown, setGrown] = useState(reduced);
  const chartRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chartRef.current;
    if (grown || !el) return;
    if (typeof IntersectionObserver === 'undefined') { setGrown(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setGrown(true); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [grown]);

  const exportMd = async () => {
    const text = await weeklyMarkdown(7);
    setMd(text);
    download(`memory-weekly-${new Date().toISOString().slice(0, 10)}.md`, text, 'text/markdown;charset=utf-8');
  };

  const label = (key: string) => (activeSet?.domain === 'cardFace' ? cardLabel(key) : key);
  const dayLabel = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

  return (
    <div className="flex flex-col gap-6">
      {/* 최근 기록 — 기간 고르기가 위 수치와 아래 막대에 함께 걸린다 */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <Dymo>최근 기록</Dymo>
          <select aria-label="기간" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7일</option><option value={14}>14일</option><option value={30}>30일</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label={`최근 ${days}일 시도`} value={`${totals.attempts}회`} />
          <Stat label="정확도" value={totals.attempts ? fmtPct(totals.accuracy) : '—'} />
          <Stat label="평균 중앙 반응시간" value={fmtMs(totals.medianRt)} />
          <Stat label="종목 세션" value={`${totals.practice}회`} />
        </div>

        <Panel title="일별 시도" right={<Key tone="cream" size="sm" onClick={exportMd}>주간 요약 내려받기</Key>}>
          <div ref={chartRef} className="flex h-32 gap-[3px] border-b border-card-edge">
            {rows.map((r) => (
              <div
                key={r.day}
                className="relative flex-1"
                title={`${r.day}\n시도 ${r.attempts} · 정확도 ${r.attempts ? fmtPct(r.accuracy) : '—'} · 중앙 ${fmtMs(r.medianRt)}`}
              >
                <div
                  className="absolute inset-0 origin-bottom rounded-t-[2px] bg-chalk"
                  style={{
                    transform: `scaleY(${grown ? r.attempts / maxAttempts : 0})`,
                    transition: 'transform var(--dur-bar) var(--ease-out)',
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-[3px]">
            {rows.map((r, i) => (
              <span key={r.day} className="tnum flex min-w-0 flex-1 justify-center whitespace-nowrap text-[9px] text-ink-2">
                {(rows.length - 1 - i) % labelStep === 0 ? dayLabel(r.day) : ''}
              </span>
            ))}
          </div>
          {md && (
            <textarea readOnly value={md} className="mt-3 h-40 w-full" onFocus={(e) => e.currentTarget.select()} />
          )}
        </Panel>
      </section>

      {/* 기초 세 단계 */}
      <section className="flex flex-col gap-2.5">
        <Dymo className="self-start">기초 단계</Dymo>
        <Panel>
          <div className="flex flex-col gap-3">
            {[
              { t: '1단계 · 자음 하나', g: m1 },
              { t: '2단계 · 자음 두 개', g: m2 },
              { t: '3단계 · 이미지', g: m3 },
            ].map((x) => (
              <div key={x.t} className="flex flex-col gap-1.5">
                <div className="font-typek text-[12px] font-bold text-ink-2">{x.t}</div>
                {x.g ? <GoalPanel goal={x.g} /> : null}
              </div>
            ))}
          </div>
        </Panel>

        {(m1?.attempts || m2?.attempts) ? (
          <Panel title="자음 매핑 숙련도">
            <div className="grid grid-cols-10 gap-1">
              {map1.map((c) => (
                <div
                  key={c.unit}
                  title={`${c.unit} · 시도 ${c.attempts} · 정확도 ${fmtPct(c.accuracy)} · ${fmtMs(c.medianRt)}`}
                  className={cellBox}
                  style={{
                    background: c.attempts === 0
                      ? 'transparent'
                      : c.accuracy < 0.9 ? wrong(1 - c.accuracy) : speed(Math.min(1, c.medianRt / 4000)),
                  }}
                >
                  <div className={`tnum text-sm font-bold ${c.attempts ? 'text-ink' : 'text-ink-2'}`}>{c.unit}</div>
                  <div className="tnum text-[10px] text-ink-2">
                    {c.attempts ? (c.medianRt / 1000).toFixed(1) : '·'}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="1단계 정확도" value={m1?.attempts ? fmtPct(m1.accuracy) : '—'} sub={`안 본 숫자 ${m1?.unseen ?? 10}개`} />
              <Stat label="1단계 반응" value={fmtMs(m1?.medianRt ?? 0)} />
              <Stat label="2단계 정확도" value={m2?.attempts ? fmtPct(m2.accuracy) : '—'} sub={`안 본 칸 ${m2?.unseen ?? 100}개`} />
              <Stat label="2단계 반응" value={fmtMs(m2?.medianRt ?? 0)} />
            </div>
            <p className={`mt-2 ${caption}`}>
              위 칸은 1단계(숫자 한 자리)입니다. 파란 칸은 아직 틀리는 숫자, 칸의 숫자는 중앙 반응시간(초)입니다.
            </p>
          </Panel>
        ) : null}
      </section>

      {/* 이미지 약점 */}
      <section className="flex flex-col gap-2.5">
        <Dymo className="self-start">이미지 약점</Dymo>
        <Panel
          title="반응시간 히트맵"
          right={
            <select aria-label="이미지 세트" value={activeSet?.id ?? ''} onChange={(e) => setSetId(e.target.value)}>
              {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          }
        >
          {cells.length === 0 ? (
            <Empty>세트에 이미지가 없습니다.</Empty>
          ) : (
            <>
              <p className="mb-2 font-typek text-[12px] text-ink-2">
                측정된 이미지 <b className="tnum text-ink">{measured.length}/{cells.length}</b>
              </p>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {cells.map((c) => (
                  <div
                    key={c.key}
                    title={`${label(c.key)} ${c.image?.name ?? ''}\n중앙 ${fmtMs(c.medianRt)} · 시도 ${c.attempts} · 오답률 ${fmtPct(c.errRate)}`}
                    className={cellBox}
                    style={{ background: color(c.medianRt, c.attempts, c.errRate) }}
                  >
                    <div className="tnum text-[10px] text-ink-2">{label(c.key)}</div>
                    <div className={`tnum text-[11px] ${c.attempts ? 'font-bold text-ink' : 'text-ink-2'}`}>
                      {c.medianRt ? (c.medianRt / 1000).toFixed(1) : c.attempts ? '✕' : '·'}
                    </div>
                  </div>
                ))}
              </div>
              <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 ${caption}`}>
                <span className="flex items-center gap-1"><i className="inline-block size-3 rounded-[2px]" style={{ background: speed(0) }} /> 빠름</span>
                <span className="flex items-center gap-1"><i className="inline-block size-3 rounded-[2px]" style={{ background: speed(1) }} /> 느림</span>
                <span className="flex items-center gap-1"><i className="inline-block size-3 rounded-[2px]" style={{ background: wrong(0.6) }} /> 오답률 34% 이상</span>
              </div>
              <p className={`mt-1 ${caption}`}>칸의 숫자는 중앙 반응시간(초) · ✕ 는 종목 회상 오답만 있고 드릴 기록 없음</p>
            </>
          )}
        </Panel>

        <Panel title="혼동 쌍 상위 10">
          {pairs.length === 0 ? (
            <Empty>아직 혼동 기록이 없습니다.</Empty>
          ) : (
            <table className="w-full font-typek text-[13px]">
              <thead className="text-[11px] text-ink-2">
                <tr>
                  <th className="py-1 text-left font-normal">정답</th><th className="text-left font-normal">답한 것</th>
                  <th className="text-right font-normal">횟수</th><th className="text-right font-normal">출처</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p, i) => (
                  <tr key={i} className="border-t border-card-edge">
                    <td className="tnum py-1.5">{p.expected}</td>
                    <td className="tnum text-blue">{p.answered}</td>
                    <td className="tnum text-right">{p.count}</td>
                    <td className="text-right text-[11px] text-ink-2">{p.source}</td>
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
            <div className="flex flex-col gap-3 font-typek text-[13px]">
              <div>
                <div className="mb-1 text-[11px] font-bold text-ink-2">가장 느림</div>
                {mv.slowest.map((m) => (
                  <div key={m.key} className="flex justify-between gap-2 border-t border-card-edge py-1.5">
                    <span className="tnum min-w-0 truncate">{m.key} {m.name}</span>
                    <span className="tnum">{fmtMs(m.medianRt)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 text-[11px] font-bold text-ink-2">오답률 높음</div>
                {mv.worst.map((m) => (
                  <div key={m.key} className="flex justify-between gap-2 border-t border-card-edge py-1.5">
                    <span className="tnum min-w-0 truncate">{m.key} {m.name}</span>
                    <span className="tnum text-blue">{fmtPct(m.errRate)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}
