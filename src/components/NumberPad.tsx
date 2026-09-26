import type { CSSProperties, RefObject } from 'react';
import { Key } from './lp';

/*
 * 계산 답 자판(휴대폰) — 1 2 3 / 4 5 6 / 7 8 9 / . 0 ⌫ 와 아래 넓은 '제출'.
 * 입력칸 없이 누름만 넘긴다(답 글자는 부르는 쪽 상태) — 칸에 포커스가 가지 않아 기기 키보드가 뜨지 않는다.
 * ⌫ 는 글자 지우기 전용이다. 빈 답에서도 앞 문제로 넘기지 않는다.
 */

/* 자판 모양(lp-key)의 여백·글자를 덮어써야 해서 style 로 준다. 세 칸이 기둥 폭을 나눠 375px 에서도 한 줄에 든다 */
const KEY: CSSProperties = { width: '100%', height: 46, fontSize: 22, padding: 0, display: 'grid', placeItems: 'center' };
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'];

/** 물리 자판으로 쳐도 같은 자판에 눌림이 보이게 — 키 이름: 숫자·'.'·'back'·'submit'·'skip' */
export type PadRefs = RefObject<Record<string, HTMLButtonElement | null>>;

export default function NumberPad({ onType, onBackspace, onSubmit, onSkip, refs }: {
  onType: (ch: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
  /** 주면 제출 옆에 '모름'(Tab) — 연습에서만 */
  onSkip?: () => void;
  refs?: PadRefs;
}) {
  const reg = (k: string) => (el: HTMLButtonElement | null) => { if (refs) refs.current[k] = el; };
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="숫자 자판">
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <Key key={k} ref={reg(k)} tone="cream" className="tnum" style={KEY} onClick={() => onType(k)}>{k}</Key>
        ))}
        <Key ref={reg('back')} tone="cream" style={KEY} aria-label="한 글자 지우기" onClick={onBackspace}>⌫</Key>
      </div>
      <div className="flex gap-2">
        {onSkip && <Key ref={reg('skip')} tone="cream" sub="Tab" className="flex-1" onClick={onSkip}>모름</Key>}
        <Key ref={reg('submit')} sub="Enter" className="flex-[2]" onClick={onSubmit}>제출</Key>
      </div>
    </div>
  );
}
