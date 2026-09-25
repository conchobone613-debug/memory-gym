import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { fx } from '../../design/fx';
import { sfx } from '../../design/sfx';
import { reduced } from '../../design/settings';

/*
 * 측정 화면 부품 — 머리띠 · 계수기 · 판정 · 문제 카드 · 붙잡힘 칸.
 * 규칙(디자인 시스템 「측정 구간」): 문제가 뜬 순간부터 답을 치는 동안 문제 카드는 크기·위치·색·그림자가
 * 변하지 않는다. 정답이면 다음 문제가 곧바로 뜨므로 정답 연출은 언제나 다음 문제의 측정과 겹친다 —
 * 그래서 판정 연출은 전부 연출 층(가장자리 빛)과 머리띠(계수기·판정 글자·연필 표시)에서만 돈다.
 */

/* ── ComboCounter: 기계식 계수기 ─────────────────────── */

const WHEELS = 3;
const BULBS = 10;
/** 가로가 긴 사각형 둘레에 전구를 고르게 */
const BULB_POS = Array.from({ length: BULBS }, (_, i) => {
  const pos = (i / BULBS) * 2 * (1 + 0.45);
  if (pos < 1) return [pos, 0];
  if (pos < 1.45) return [1, (pos - 1) / 0.45];
  if (pos < 2.45) return [1 - (pos - 1.45), 1];
  return [0, 1 - (pos - 2.45) / 0.45];
});

/** 연속 정답 수. 5·10·20·50연속에서 둘레 전구 3·5·8·10개. 오답이면 0으로 되감긴다. 연습에서만 켠다. */
export const ComboCounter = forwardRef<HTMLSpanElement, { n: number }>(function ComboCounter({ n }, ref) {
  const prev = useRef(n);
  const [rewind, setRewind] = useState(false);
  const bulbsRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const was = prev.current;
    prev.current = n;
    if (n === 0 && was > 0) {
      setRewind(true);
      const t = window.setTimeout(() => setRewind(false), 380);
      return () => window.clearTimeout(t);
    }
    if (fx.tier(n) > fx.tier(was) && !reduced()) {
      Array.from(bulbsRef.current?.children ?? []).forEach((b, i) =>
        b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.8)' }, { transform: 'scale(1)' }], { duration: 220, delay: i * 30 }));
    }
  }, [n]);

  const digits = String(Math.min(Math.max(n, 0), 999)).padStart(WHEELS, '0');
  const lit = fx.litBulbs(n);
  return (
    <span className="lp-counter" ref={ref} aria-label={`연속 ${n}`}>
      <span className="lp-bulbs" ref={bulbsRef} aria-hidden>
        {BULB_POS.map(([x, y], i) => (
          <i key={i} className={`lp-bulb${i < lit ? ' is-on' : ''}`} style={{ left: `calc(${x * 100}% - 3px)`, top: `calc(${y * 100}% - 3px)` }} />
        ))}
      </span>
      <span className="lp-wheels" aria-hidden>
        {digits.split('').map((d, i) => (
          <span key={i} className={`lp-wheel${rewind ? ' is-rewind' : ''}`}>
            <span style={{ transform: `translateY(${-24 * Number(d)}px)` }}>
              {Array.from({ length: 10 }, (_, k) => <b key={k}>{k}</b>)}
            </span>
          </span>
        ))}
      </span>
      <small>연속</small>
    </span>
  );
});

/* ── useJudge: 판정 연출 ─────────────────────────────── */

export type JudgeKind = 'good' | 'bad' | 'skip';

export interface JudgeState {
  kind: JudgeKind;
  /** 평문: '정답' · 'n연속'(단계 돌파 순간) · '오답' · '모름' */
  text: string;
  /** 같은 판정이 이어져도 연출을 다시 틀기 위한 번호 */
  id: number;
}

/**
 * 판정 연출. 화면이 판정 결과를 한곳에서 넘긴다: judge.show('good', 지금 연속 수, 문제 카드).
 * 문제 카드는 조각이 넘지 않을 선(윗선)을 재는 데만 쓰고, 카드에는 아무것도 걸지 않는다.
 * judge.layer 를 화면 어딘가에 한 번 그리고, <Hud judge={judge}> 로 판정 글자·연필 표시를 머리띠에 띄운다.
 */
export function useJudge() {
  const layerRef = useRef<HTMLDivElement>(null);
  const goodRef = useRef<HTMLDivElement>(null);
  const badRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const tierRef = useRef(0);
  const idRef = useRef(0);
  const [state, setState] = useState<JudgeState | null>(null);

  const show = useCallback((kind: JudgeKind, streak = 0, card?: HTMLElement | null) => {
    idRef.current += 1;
    const id = idRef.current;
    if (kind === 'good') {
      const t = fx.tier(streak);
      const up = t > tierRef.current;
      tierRef.current = t;
      sfx.good(streak);
      fx.flash(goodRef.current, 0.95);
      setState({ kind, text: up ? `${streak}연속` : '정답', id });
      const layer = layerRef.current;
      const counter = counterRef.current;
      if (layer && counter) {
        const L = layer.getBoundingClientRect();
        const C = counter.getBoundingClientRect();
        const x = C.left - L.left + C.width / 2;
        const y = C.top - L.top + C.height / 2;
        const floor = card ? card.getBoundingClientRect().top - L.top - 4 : y + 40;
        fx.spray(layer, x, y, 7 + Math.min(streak, 10), 'chad', 1, floor);
        if (up) {
          sfx.carriage();
          fx.spray(layer, x, y, 24, 'tape', 1.5, floor);
        }
      }
    } else if (kind === 'bad') {
      tierRef.current = 0;
      sfx.bad();
      fx.flash(badRef.current, 0.85, 280);
      setState({ kind, text: '오답', id });
    } else {
      tierRef.current = 0;
      sfx.skip();
      setState({ kind, text: '모름', id });
    }
  }, []);

  /** 틀려서 붙잡힌 뒤(측정이 끝난 뒤)에만 카드를 한 번 흔든다(2px, 140ms). */
  const shake = useCallback((el: HTMLElement | null) => {
    if (!el || reduced()) return;
    el.animate([{ transform: 'none' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(2px)' }, { transform: 'none' }], { duration: 140 });
  }, []);

  /** 새 판을 시작할 때 */
  const reset = useCallback(() => { tierRef.current = 0; setState(null); }, []);

  const layer = (
    <div className="lp-fx" ref={layerRef} aria-hidden>
      <div className="lp-edge is-good" ref={goodRef} />
      <div className="lp-edge is-bad" ref={badRef} />
    </div>
  );

  return { show, shake, reset, layer, counterRef, state };
}

export type Judge = ReturnType<typeof useJudge>;

/* ── Hud: 측정 화면 머리띠 ───────────────────────────── */

/**
 * 왼쪽 진행(예: "이미지 3단계 · 14/40"), 오른쪽 계수기. streak 을 주지 않으면 계수기를 숨긴다(모의 대회).
 * 판정 글자는 계수기 아래, 연필 표시는 계수기 왼쪽 — 문제 카드 밖이다.
 */
export function Hud({ left, streak, judge, right }: { left: ReactNode; streak?: number; judge?: Judge; right?: ReactNode }) {
  const st = judge?.state;
  return (
    <div className="lp-hud relative">
      <span>{left}</span>
      <span className="flex items-center gap-3">
        {st && st.kind !== 'skip' && <PencilMark key={`m${st.id}`} kind={st.kind} />}
        {right}
        {streak != null && <ComboCounter n={streak} ref={judge?.counterRef} />}
      </span>
      {st && (
        <span
          key={`j${st.id}`}
          className={`lp-judge lp-judge-show absolute right-0 top-[48px]${st.kind === 'bad' ? ' is-bad' : st.kind === 'skip' ? ' is-skip' : ''}`}
          role="status"
        >
          {st.text}
        </span>
      )}
    </div>
  );
}

/** 연필 표시: 정답 = 빨간 체크, 오답 = 파란 X. 180ms 동안 긋고 650ms 동안 사라진다. */
function PencilMark({ kind }: { kind: 'good' | 'bad' }) {
  return (
    <svg className="lp-mark" viewBox="0 0 38 38" width="30" height="30" aria-hidden>
      {kind === 'good'
        ? <path d="M6 20 L15 29 L33 7" fill="none" stroke="var(--red)" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
        : <path d="M9 9 L29 29 M29 9 L9 29" fill="none" stroke="var(--blue)" strokeWidth="3.6" strokeLinecap="round" pathLength={1} />}
    </svg>
  );
}

/* ── QuestionCard · Held ───────────────────────────── */

/**
 * 문제 카드. 측정 구간 동안 움직이지도 색이 바뀌지도 않는다 — 여기에 연출 클래스를 걸지 말 것.
 * 글자 크기는 화면마다 하나로 고정한다(size). 문제마다 바꾸면 읽는 시간이 달라진다.
 */
export const QuestionCard = forwardRef<HTMLDivElement, {
  prompt: ReactNode; size?: 'xl' | 'l' | 'm'; help?: ReactNode; children?: ReactNode; className?: string;
}>(function QuestionCard({ prompt, size = 'xl', help, children, className }, ref) {
  return (
    <div ref={ref} className={`lp-question${className ? ` ${className}` : ''}`}>
      <div className={`lp-question-num${size === 'l' ? ' is-l' : size === 'm' ? ' is-m' : ''}`}>{prompt}</div>
      {children}
      {help && <div className="lp-question-help">{help}</div>}
    </div>
  );
});

/** 틀렸을 때만 정답이 붙잡혀 나오는 칸. 문제 카드 아래에 둔다. */
export function Held({ children }: { children: ReactNode }) {
  return <div className="lp-held">{children}</div>;
}
