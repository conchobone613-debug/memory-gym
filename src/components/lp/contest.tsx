import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sfx } from '../../design/sfx';

/*
 * 모의 대회 — 방해 요소 없는 전체 화면, 3-2-1 카운트다운, 판정 연출 없음, 끝나면 결과 화면.
 * (디자인 시스템 「화면 틀」 모의 대회 · 기획서 §8.1)
 */

/** 3 · 2 · 1 · 시작. 숫자마다 틱 소리. 움직임 줄이기면 숫자만 바뀐다(소리는 그대로). 끝나면 onDone. */
export function Countdown({ onDone, stepMs = 700 }: { onDone: () => void; stepMs?: number }) {
  const [i, setI] = useState(0);
  const doneRef = useRef(onDone);
  useLayoutEffect(() => { doneRef.current = onDone; });
  const LABELS = ['3', '2', '1', '시작'];

  useEffect(() => {
    if (i < LABELS.length) sfx.tick(i * 4);
    const t = window.setTimeout(() => {
      if (i + 1 < LABELS.length) setI(i + 1);
      else doneRef.current();
    }, i === LABELS.length - 1 ? stepMs / 2 : stepMs);
    return () => window.clearTimeout(t);
  }, [i, stepMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = i === LABELS.length - 1;
  return (
    <div className="lp-countdown" role="timer" aria-live="assertive">
      <b key={i} className={go ? 'is-go' : undefined}>{LABELS[i]}</b>
    </div>
  );
}

/**
 * 모의 대회의 '방해 요소 없는 화면' — active 동안 앱 머리말과 아래 탭을 내린다(<html data-focus>).
 * 전체 화면을 브라우저가 막아도(휴대폰 사파리 등) 이것은 된다.
 */
export function useFocusMode(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.dataset.focus = 'on';
    return () => { delete root.dataset.focus; };
  }, [active]);
}

/**
 * active 동안 전체 화면. 브라우저가 막으면(휴대폰 사파리 등) 조용히 넘어간다 — 화면 틀은 그대로 비운다.
 * 전체 화면은 사용자 동작(누름) 안에서만 켜지므로, 시작 버튼의 onClick 에서 enter() 를 부른다.
 */
export function useFullscreen() {
  const enter = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  };
  const exit = () => {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  };
  useEffect(() => exit, []);
  return { enter, exit };
}
