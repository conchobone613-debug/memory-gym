import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { fx } from '../../design/fx';
import { sfx } from '../../design/sfx';
import { reduced } from '../../design/settings';
import { outcomeTitle, passedOf, starsOf, type RunOutcome } from '../../lib/outcome';
import { Key, SageNote, Stamp, Star, art } from './basic';

/*
 * 결과 화면 — 성적표. 화면은 RunOutcome 하나만 넘긴다(판정·결과 값을 한곳에서 받는다).
 *
 * 공개 순서(디자인 시스템 「움직임」 결과 공개 순서, 시안 실측값):
 *   0·120·240·360ms 글자판 넷 → 900ms ▲ 좋아짐 + 목표 막대 셋(70ms 간격) → 1450ms + 240ms×n 금별
 *   → 별 뒤 120ms 도장 → 아까움이면 안내 칸·막대 떨림·똑딱·'한 판 더' 커짐 / 신기록이면 무대·전구·현수막·테이프·팡파르.
 * 아무 키나 누르면(또는 화면을 누르면) 곧장 끝 상태. 끝난 뒤 Enter = 한 판 더.
 * 신기록 무대는 화면 뒤(고정 층)에 켜지므로, 결과와 함께 보일 내용은 children 으로 넘긴다.
 */

export function ResultSheet({ outcome, onAgain, againLabel = '한 판 더', actions, children }: {
  outcome: RunOutcome;
  onAgain?: () => void;
  againLabel?: string;
  /** '한 판 더' 아래 보조 동작(크림색 자판 등) */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const stars = starsOf(outcome);
  const passed = passedOf(outcome);
  const isNear = !outcome.record && !!outcome.near?.length;
  const isRecord = !!outcome.record;

  const [done, setDone] = useState(false);
  const [upOn, setUpOn] = useState(false);
  const [starsOn, setStarsOn] = useState(0);
  const [stampOn, setStampOn] = useState(false);
  const [nearOn, setNearOn] = useState(false);
  const [recordOn, setRecordOn] = useState(false);

  const flapRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const starRefs = useRef<(SVGSVGElement | null)[]>([]);
  const stampRef = useRef<HTMLDivElement>(null);
  const againRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const marqRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<() => void>(() => {});

  const onAgainRef = useRef(onAgain);
  useLayoutEffect(() => { onAgainRef.current = onAgain; });

  /* 글자판은 fx.flip 이 칸을 직접 그린다 — React 는 그 안을 건드리지 않는다. */
  useLayoutEffect(() => {
    let alive = true;
    const stats = outcome.stats.slice(0, 4);
    const finishes: (() => void)[] = [];
    setDone(false);
    setUpOn(false);
    setStarsOn(0);
    setStampOn(false);
    setNearOn(false);
    setRecordOn(false);
    const settleBars = () => {
      barRefs.current.forEach((el, i) => {
        if (!el) return;
        el.getAnimations().forEach((a) => a.cancel());
        el.style.setProperty('--w', String(outcome.goals[i]?.ratio ?? 0));
      });
    };
    const final = () => {
      finishes.forEach((f) => f());
      if (!alive) return;
      settleBars();
      setUpOn(true);
      setStarsOn(stars);
      setStampOn(passed);
      setNearOn(isNear);
      setRecordOn(isRecord);
      setDone(true);
    };

    /* 처음부터 끝 상태로 그려야 하는 경우: 움직임 줄이기 */
    stats.forEach((s, i) => {
      const el = flapRefs.current[i];
      if (el) finishes.push(fx.flip(el, s.value, i * 120));
    });

    if (reduced()) {
      final();
      if (isRecord) sfx.fanfare();
      skipRef.current = () => {};
      return () => { alive = false; };
    }

    barRefs.current.forEach((el) => el?.style.setProperty('--w', '0'));
    const hasUp = stats.some((s) => s.up);
    const starAt = (i: number) => 1450 + i * 240;
    const stampAt = starAt(stars) + 120;
    const endAt = stampAt + (passed ? 260 : 0);

    const steps: [number, () => void][] = [
      [900, () => {
        setUpOn(true);
        if (hasUp) sfx.better();
        barRefs.current.forEach((el, i) => {
          const w = outcome.goals[i]?.ratio ?? 0;
          const a = el?.animate([{ transform: 'scaleX(0)' }, { transform: `scaleX(${w})` }],
            { duration: 480, delay: i * 70, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
          if (a && el) a.onfinish = () => { el.style.setProperty('--w', String(w)); a.cancel(); };
        });
      }],
      ...Array.from({ length: stars }, (_, i): [number, () => void] => [starAt(i), () => {
        setStarsOn(i + 1);
        sfx.star(i);
        starRefs.current[i]?.animate(
          [{ transform: 'scale(2.2) rotate(-40deg)', opacity: 0 }, { transform: 'scale(.9) rotate(4deg)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
          { duration: 220, easing: 'ease-out' });
      }]),
    ];
    if (passed) {
      steps.push([stampAt, () => {
        setStampOn(true);
        sfx.stamp();
        stampRef.current?.animate(
          [{ transform: 'scale(2.4)', opacity: 0 }, { transform: 'scale(.95)', opacity: 0.92, offset: 0.75 }, { transform: 'none', opacity: 0.92 }],
          { duration: 190, easing: 'cubic-bezier(.5,0,.8,.4)' });
        sheetRef.current?.animate(
          [{ transform: 'none' }, { transform: 'translate(1px,2px)' }, { transform: 'translate(-1px,-1px)' }, { transform: 'none' }],
          { duration: 120, delay: 140 });
      }]);
    }
    if (isNear) {
      steps.push([endAt, () => {
        setNearOn(true);
        sfx.tense();
        const miss = outcome.goals.findIndex((g) => !g.met);
        const bar = barRefs.current[miss];
        const w = outcome.goals[miss]?.ratio ?? 0;
        bar?.animate([{ transform: `scaleX(${w})` }, { transform: `scaleX(${Math.max(0, w - 0.008)})` }, { transform: `scaleX(${w})` }], { duration: 100, iterations: 6 });
        againRef.current?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1.03)' }],
          { duration: 300, fill: 'forwards', easing: 'cubic-bezier(.3,1.6,.6,1)' });
      }]);
    }
    if (isRecord) {
      steps.push([endAt, () => {
        setRecordOn(true);
        sfx.fanfare();
        stageRef.current?.animate([{ opacity: 0 }, { opacity: 0.95 }], { duration: 500, fill: 'forwards' });
        Array.from(marqRef.current?.children ?? []).forEach((b, i) =>
          b.animate([{ opacity: 0.25 }, { opacity: 1 }, { opacity: 0.25 }], { duration: 480, delay: (i % 6) * 80, iterations: 4 }));
        bannerRef.current?.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1.1)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'ease-out' });
        const layer = fxRef.current;
        if (layer) {
          const r = layer.getBoundingClientRect();
          fx.spray(layer, r.width / 2, r.height * 0.22, 70, 'tape', 3.4);
        }
      }]);
    }
    skipRef.current = fx.sequence(steps, final);
    /* 떠날 때: 남은 타이머(순서표·글자판)만 멈추고 상태는 건드리지 않는다 */
    return () => { alive = false; skipRef.current(); };
    // outcome 이 바뀌면 처음부터 다시 공개한다(한 판 더를 새 판으로 할 때 화면이 새로 그려진다).
  }, [outcome]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 공개 중에는 아무 키나 = 건너뛰기(그 키는 다른 곳으로 가지 않는다). 끝난 뒤 Enter = 한 판 더. */
  const onKey = useCallback((e: KeyboardEvent) => {
    if (!done) {
      e.preventDefault();
      e.stopPropagation();
      skipRef.current();
      return;
    }
    const t = e.target instanceof Element ? e.target : null;
    /* 결과 위에 대화상자(이름 고치기 등)가 떠 있으면 Enter 는 그쪽 몫이다 */
    const modalOpen = !!document.querySelector('[aria-modal="true"]');
    if (e.key === 'Enter' && onAgainRef.current && !modalOpen && !(t && t.closest('input, textarea, select, button, a'))) {
      e.preventDefault();
      sfx.key(true);
      onAgainRef.current();
    }
  }, [done]);

  useEffect(() => {
    const down = () => { if (!done) skipRef.current(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', down, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', down, true);
    };
  }, [onKey, done]);

  const stats = outcome.stats.slice(0, 4);

  return (
    <>
      {isRecord && (
        <>
          <div ref={stageRef} className="lp-stage lp-crt" style={{ opacity: recordOn ? 0.95 : 0 }} aria-hidden>
            <img src={art('stage.webp')} alt="" />
          </div>
          <div ref={marqRef} className="lp-marquee" style={{ opacity: recordOn ? 1 : 0 }} aria-hidden>
            {MARQUEE.map(([x, y], i) => <i key={i} style={{ left: `calc(${x * 100}% - 3.5px)`, top: `calc(${y * 100}% - 3.5px)` }} />)}
          </div>
        </>
      )}
      <div ref={fxRef} className="lp-fx" aria-hidden />

      <div className="relative z-[1] flex flex-col gap-2.5">
        <div ref={sheetRef} className="lp-sheet">
          <div className="lp-sheet-title">
            {isRecord && recordOn ? (
              <span ref={bannerRef} className="lp-banner">
                신기록입니다
                <small>{outcome.record!.what}</small>
              </span>
            ) : (
              outcomeTitle(outcome)
            )}
          </div>

          <div className="lp-flaps">
            {stats.map((s, i) => (
              <div key={s.label}>
                <small>{s.label}</small>
                <span className="lp-flap" ref={(el) => { flapRefs.current[i] = el; }} aria-label={`${s.label} ${s.value}${s.unit ?? ''}`} />
                {s.unit && <span className="lp-flap-unit">{s.unit}</span>}
                {s.up && <span className="lp-up" style={{ opacity: upOn ? 1 : 0 }}>{s.up}</span>}
              </div>
            ))}
          </div>

          {outcome.goals.length > 0 && (
            <div className="lp-bars">
              {outcome.goals.map((g, i) => (
                <div key={g.label} className="lp-bar">
                  <span>{g.label}</span>
                  <span className="lp-bar-track">
                    <span className="lp-bar-fill" ref={(el) => { barRefs.current[i] = el; }} style={{ '--w': g.ratio } as CSSProperties} />
                    <span className="lp-bar-goal" />
                  </span>
                  <span className="lp-bar-num">{g.text}</span>
                </div>
              ))}
            </div>
          )}

          {outcome.goals.length > 0 && (
            <div className="lp-awards">
              <span className="lp-stars" aria-label={`금별 ${stars}개`}>
                {[0, 1, 2].map((i) => (
                  <span key={i} ref={(el) => { starRefs.current[i] = el?.firstElementChild as SVGSVGElement | null; }}>
                    <Star off={i >= starsOn} />
                  </span>
                ))}
              </span>
              <div ref={stampRef} style={{ opacity: stampOn ? 0.92 : 0 }} aria-hidden={!stampOn}>
                {passed && <Stamp>합격</Stamp>}
              </div>
            </div>
          )}
        </div>

        {isNear && nearOn && (
          <div className="lp-near" role="status">
            {outcome.near!.map((n, i) => (
              <span key={i}>{i > 0 && ' · '}{n.lead} <b>{n.value}</b></span>
            ))}
          </div>
        )}

        {outcome.sage && <SageNote small>{outcome.sage}</SageNote>}

        {onAgain && (
          <div ref={againRef}>
            <Key tone="red" size="big" sub="Enter" onClick={onAgain}>{againLabel}</Key>
          </div>
        )}
        {actions}
        {!done && <div className="lp-skip">숫자가 넘어가는 동안 아무 키나 누르면 끝 상태로 건너뜁니다.</div>}

        {children}
      </div>
    </>
  );
}

/** 무대 테두리 전구 36개 */
const MARQUEE = Array.from({ length: 36 }, (_, i) => {
  const t = (i / 36) * 4;
  if (t < 1) return [t, 0];
  if (t < 2) return [1, t - 1];
  if (t < 3) return [3 - t, 1];
  return [0, 4 - t];
});
