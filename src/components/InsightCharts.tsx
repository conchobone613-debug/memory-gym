import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import type { DayMinutes } from '../db/insights';
import {
  fmtMin, labelEvery, nearestIndex, niceScale, SERIES_COLOR, shortDay, slotAt, sparkPoints, stackPx,
} from '../lib/chart';

/*
 * 기록 탭 그래프 — 영역별 훈련 시간(쌓은 막대)과 종목 추세선. 차트 라이브러리 없이 HTML·SVG 로 그린다.
 * 축은 하나, 격자는 흐리게, 글자는 글자색(계열 색은 막대·선·색 점에만). 누르거나 올리면 풍선, 밖을 누르면 닫힌다.
 */

type Series = keyof typeof SERIES_COLOR;

/** 범례·풍선의 색 점 — 계열을 알려 주는 것은 이 점이고, 옆 글자는 글자색이다 */
export function SeriesKey({ d, line }: { d: Series; line?: boolean }) {
  return (
    <i
      aria-hidden
      className={`inline-block shrink-0 ${line ? 'h-[3px] w-2.5 rounded-full' : 'size-2.5 rounded-[2px]'}`}
      style={{ background: SERIES_COLOR[d] }}
    />
  );
}

/** 고른 칸 — 누르면 고르고, 그 그래프 밖을 누르면 놓는다(휴대폰에는 올리기가 없어 누른 풍선이 남아야 한다) */
function usePick(ref: RefObject<HTMLElement | null>) {
  const [idx, setIdx] = useState<number | null>(null);
  useEffect(() => {
    if (idx == null) return;
    const off = (e: globalThis.PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setIdx(null);
    };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [idx, ref]);
  return [idx, setIdx] as const;
}

/** 그릇의 폭(px) — SVG 를 늘리지 않고 폭에 맞춰 다시 그려야 선 굵기·점이 찌그러지지 않는다 */
function useWidth(ref: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** 풍선 — at(0~100%)만큼 왼쪽으로 당겨 양 끝에서도 그릇 밖으로 나가지 않는다 */
function Bubble({ at, top, children }: { at: number; top: number; children: ReactNode }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 whitespace-nowrap rounded-[4px] border border-card-edge bg-input px-2 py-1 font-typek text-[11.5px] leading-snug text-ink shadow-[var(--paper-lift)]"
      style={{ left: `${at}%`, top, transform: `translate(-${at}%, -100%)` }}
    >
      {children}
    </div>
  );
}

const PLOT_H = 120;

/** 영역별 훈련 시간 — 날마다 쌓은 막대 하나(아래 기억력 · 위 계산). 분 축 하나 */
export function MinutesChart({ rows }: { rows: DayMinutes[] }) {
  const plot = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = usePick(plot);
  const n = rows.length;
  const sel = idx != null && idx < n ? idx : null;
  const { top, ticks } = niceScale(Math.max(0, ...rows.map((r) => r.memoryMin + r.calcMin)));
  const every = labelEvery(n);

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setIdx(slotAt(e.clientX - r.left, r.width, n));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      setIdx((i) => (i == null ? n - 1 : Math.min(n - 1, Math.max(0, i + d))));
    } else if (e.key === 'Escape') setIdx(null);
  };
  const r = sel != null ? rows[sel] : null;

  return (
    <div>
      <div className="flex">
        <div aria-hidden className="relative w-7 shrink-0" style={{ height: PLOT_H }}>
          {ticks.map((t) => (
            <span key={t} className="tnum absolute right-1.5 text-[9.5px] leading-none text-ink-2" style={{ bottom: (t / top) * PLOT_H - 4 }}>
              {t}
            </span>
          ))}
          <span className="absolute -top-4 right-1.5 font-typek text-[9.5px] text-ink-2">분</span>
        </div>
        <div
          ref={plot}
          tabIndex={0}
          role="group"
          aria-label="영역별 훈련 시간 막대. 좌우 화살표로 날을 고릅니다."
          className="relative min-w-0 flex-1 cursor-pointer select-none"
          style={{ height: PLOT_H }}
          onPointerDown={pick}
          onPointerMove={pick}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setIdx(null); }}
          onKeyDown={onKey}
          onFocus={() => setIdx((i) => i ?? n - 1)}
          onBlur={() => setIdx(null)}
        >
          {ticks.map((t) => (
            <div
              key={t}
              aria-hidden
              className={`absolute inset-x-0 h-px ${t === 0 ? 'bg-card-edge' : 'bg-card-edge/60'}`}
              style={{ bottom: (t / top) * PLOT_H }}
            />
          ))}
          <div aria-hidden className="absolute inset-0 flex gap-[2px]">
            {rows.map((d, i) => {
              const s = stackPx(d.memoryMin, d.calcMin, top, PLOT_H);
              const seg = (h: number, c: string, round: boolean) => (
                <div
                  className="w-full max-w-6 transition-[height] duration-[var(--dur-bar)] ease-[var(--ease-out)]"
                  style={{ height: h, background: c, borderRadius: round ? '4px 4px 0 0' : 0 }}
                />
              );
              return (
                <div key={d.day} className="flex min-w-0 flex-1 flex-col-reverse items-center" style={{ opacity: sel != null && sel !== i ? 0.45 : 1 }}>
                  {seg(s.memory, SERIES_COLOR.memory, s.calc === 0)}
                  {s.gap > 0 && <div style={{ height: s.gap }} />}
                  {seg(s.calc, SERIES_COLOR.calc, true)}
                </div>
              );
            })}
          </div>
          {r && sel != null && (
            <Bubble at={((sel + 0.5) / n) * 100} top={-6}>
              <b>{shortDay(r.day)}</b>
              <span className="text-ink-2"> · </span>
              <span className="inline-flex items-center gap-1 align-middle"><SeriesKey d="memory" line />기억력 <b className="tnum">{fmtMin(r.memoryMin)}</b></span>
              <span className="text-ink-2"> · </span>
              <span className="inline-flex items-center gap-1 align-middle"><SeriesKey d="calc" line />계산 <b className="tnum">{fmtMin(r.calcMin)}</b></span>
            </Bubble>
          )}
        </div>
      </div>
      <div aria-hidden className="mt-1 ml-7 flex gap-[2px]">
        {rows.map((d, i) => (
          <span key={d.day} className="tnum flex min-w-0 flex-1 justify-center whitespace-nowrap text-[9px] text-ink-2">
            {(n - 1 - i) % every === 0 ? shortDay(d.day) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

const TREND_H = 48;
/** 왼쪽 범위 글자 자리 · 오른쪽 끝 값 글자 자리 */
const TREND_GUT = 30;
const TREND_END = 50;

/** 종목 추세선 — 한 계열(범례 없음). 2px 선 · 마지막 점 8px · 마지막 값을 선 끝에 직접. 값이 하나면 점만 */
export function TrendLine({ values, days, unit, color, label }: {
  values: number[]; days: string[]; unit: string; color: string; label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const w = useWidth(wrap);
  const [idx, setIdx] = usePick(wrap);
  const n = values.length;
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const range = n > 1 && hi !== lo;
  const box = { x0: range ? TREND_GUT : 4, x1: Math.max(40, w - TREND_END), y0: 9, y1: TREND_H - 9 };
  const pts = w > 0 && n > 0 ? sparkPoints(values, box) : [];
  const last = pts[pts.length - 1];
  const sel = idx != null && idx < pts.length ? idx : null;
  const val = (v: number) => `${v}${unit}`;

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    if (!pts.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    setIdx(nearestIndex(pts.map((p) => p.x), e.clientX - r.left));
  };

  const dot = (p: { x: number; y: number }) => (
    <>
      <circle cx={p.x} cy={p.y} r={6} fill="var(--card)" />
      <circle cx={p.x} cy={p.y} r={4} fill={color} />
    </>
  );

  return (
    <div>
      <div className="font-typek text-[10.5px] text-ink-2">{label} · 최근 {n}판</div>
      <div
        ref={wrap}
        role="img"
        aria-label={`${label} 추세 ${n}판, 최근 ${val(values[n - 1])}${range ? `, 가장 높음 ${val(hi)}, 가장 낮음 ${val(lo)}` : ''}`}
        className="relative cursor-pointer select-none"
        style={{ height: TREND_H }}
        onPointerDown={pick}
        onPointerMove={pick}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setIdx(null); }}
      >
        {w > 0 && last && (
          <svg width={w} height={TREND_H} className="block overflow-visible" aria-hidden>
            {range && (
              <>
                <line x1={box.x0} x2={box.x1} y1={box.y0} y2={box.y0} stroke="var(--card-edge)" strokeWidth={1} />
                <line x1={box.x0} x2={box.x1} y1={box.y1} y2={box.y1} stroke="var(--card-edge)" strokeWidth={1} />
                <text x={box.x0 - 5} y={box.y0} textAnchor="end" dominantBaseline="middle" fontSize={9.5} fill="var(--ink-2)" className="tnum">{hi}</text>
                <text x={box.x0 - 5} y={box.y1} textAnchor="end" dominantBaseline="middle" fontSize={9.5} fill="var(--ink-2)" className="tnum">{lo}</text>
              </>
            )}
            {n > 1 && (
              <polyline
                points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {sel != null && sel !== pts.length - 1 && dot(pts[sel])}
            {dot(last)}
            <text
              x={last.x + 8}
              y={Math.min(TREND_H - 7, Math.max(7, last.y))}
              dominantBaseline="middle"
              fontSize={11.5}
              fontWeight={700}
              fill="var(--ink)"
              className="tnum"
            >
              {val(values[n - 1])}
            </text>
          </svg>
        )}
        {sel != null && pts[sel] && (
          <Bubble at={(pts[sel].x / Math.max(1, w)) * 100} top={pts[sel].y - 8}>
            {shortDay(days[sel])} · <b className="tnum">{val(values[sel])}</b>
          </Bubble>
        )}
      </div>
    </div>
  );
}

