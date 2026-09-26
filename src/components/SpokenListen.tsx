import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createReader, readingMs, SPOKEN_LEAD_MS, wordsOf, type SpokenLang } from '../lib/spoken';
import { pickVoice, speakWord, stopSpeech } from '../lib/speech';
import { Panel } from './ui';
import { Hud, Key } from './lp';

/*
 * 듣고 외우는 숫자의 암기 단계 — 낭독만 한다. 측정 화면이라 가운데는 멈춘 안내 한 장뿐이고,
 * '외웠습니다' 는 없다(다 읽으면 intervalMs 뒤에 onDone). 되감기가 없는 종목이라 탭이 숨으면 그 판은 무효다.
 */

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export default function SpokenListen({ digits, intervalMs, lang, onDone, onCancel }: {
  /** 판 동안 같은 배열이어야 한다 — 바뀌면 낭독을 처음부터 다시 연다 */
  digits: string[];
  intervalMs: number;
  lang: SpokenLang;
  /** 실제 낭독 시간(시작 ~ 마지막 낱말 + 간격) */
  onDone: (usedMs: number) => void;
  onCancel: (reason?: 'hidden') => void;
}) {
  const [said, setSaid] = useState(0);
  /** 낭독을 시작한 때(performance.now). 목소리를 고르는 동안은 0 */
  const [t0, setT0] = useState(0);
  const [now, setNow] = useState(0);

  /* 부모가 다시 그려도 낭독이 다시 시작되지 않게 콜백은 ref 로 붙든다 */
  const doneRef = useRef(onDone);
  const cancelRef = useRef(onCancel);
  useLayoutEffect(() => {
    doneRef.current = onDone;
    cancelRef.current = onCancel;
  });

  useEffect(() => {
    let alive = true;
    let reader: { stop(): void } | null = null;
    let lock: WakeLockSentinel | null = null;

    /* 화면이 꺼지면 낭독이 끊긴다. 지원하지 않는 기기에서는 조용히 넘어간다 */
    try {
      navigator.wakeLock?.request('screen')
        .then((l) => { if (alive) lock = l; else l.release().catch(() => {}); })
        .catch(() => {});
    } catch { /* 화면 잠금 없이 진행 */ }

    const hide = () => {
      if (!alive) return;
      reader?.stop();
      stopSpeech();
      cancelRef.current('hidden');
    };
    const onVis = () => { if (document.visibilityState === 'hidden') hide(); };
    document.addEventListener('visibilitychange', onVis);

    /* 목소리를 못 고르면 기본 목소리로 — 박자는 목소리와 상관없이 간다 */
    pickVoice(lang).catch(() => null).then((voice) => {
      if (!alive) return;
      if (document.visibilityState === 'hidden') { hide(); return; }
      const start = performance.now();
      setT0(start);
      setNow(start);
      const r = createReader({
        words: wordsOf(digits, lang),
        intervalMs,
        leadMs: SPOKEN_LEAD_MS,
        speak: (w) => speakWord(w, voice, lang),
        now: () => performance.now(),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (id) => window.clearTimeout(id as number),
        onTick: (i) => setSaid(i + 1),
        onEnd: () => doneRef.current(Math.round(performance.now() - start)),
      });
      reader = r;
      r.start();
    });

    return () => {
      alive = false;
      reader?.stop();
      stopSpeech();
      lock?.release().catch(() => {});
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [digits, intervalMs, lang]);

  useEffect(() => {
    if (!t0) return;
    const t = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(t);
  }, [t0]);

  const total = readingMs(digits.length, intervalMs);
  const left = t0 ? total - (now - t0) : total;

  return (
    <div className="flex flex-col gap-3">
      <Hud
        left={<>듣기 · <b>{said}</b>/{digits.length}자리</>}
        right={<span className="tnum text-[26px] font-bold leading-none text-ink">{mmss(left)}</span>}
      />
      <div className="flex justify-end">
        <Key tone="cream" sub="Esc" onClick={() => cancelRef.current()}>취소</Key>
      </div>
      <Panel>
        <div className="py-14 text-center">
          <p className="m-0 font-sign text-[28px] leading-tight text-ink">귀로만 들으십시오</p>
          <p className="m-0 mt-2 font-typek text-xs text-ink-2">되감기는 없습니다</p>
        </div>
      </Panel>
    </div>
  );
}
