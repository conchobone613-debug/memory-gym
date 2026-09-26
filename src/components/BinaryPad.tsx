import type { MouseEvent } from 'react';
import { Key } from './lp';

/*
 * 이진수 회상 자판(휴대폰) — 0 · 1 · 지우기. 칸에 넣는 일은 부르는 쪽이 맡고 여기는 누름만 넘긴다.
 * 화면 아래에 붙어 있다가 목록 끝에서는 제자리로 내려와 마지막 줄을 가리지 않는다(sticky).
 * 누를 때 칸의 포커스를 빼앗지 않게 mousedown 기본 동작을 막는다.
 */

/* 자판 모양(lp-key)의 여백·글자를 덮어써야 해서 style 로 준다(부품 CSS 가 Tailwind 보다 우선한다) */
const KEY = { height: 56, fontSize: 26, padding: 0, display: 'grid', placeItems: 'center' } as const;
/** 아래 탭(56px + 윗선 1px) 위에 뜬다 — 연습에서는 탭이 보인다 */
const ABOVE_NAV = 'calc(57px + env(safe-area-inset-bottom))';

const keep = (e: MouseEvent) => e.preventDefault();

export default function BinaryPad({ onPress, onBackspace, aboveNav }: {
  onPress: (ch: '0' | '1') => void;
  /** 글자 지우기 전용 — 빈 칸에서 앞 칸으로 넘기지 않는다 */
  onBackspace: () => void;
  aboveNav: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="이진수 자판"
      className={`sticky z-10 -mx-3.5 grid grid-cols-3 gap-2 border-t border-card-edge bg-paper px-3.5 pt-2 ${aboveNav ? 'pb-2' : 'pb-[max(8px,env(safe-area-inset-bottom))]'}`}
      style={{ bottom: aboveNav ? ABOVE_NAV : 0 }}
    >
      <Key tone="cream" className="tnum" style={KEY} onMouseDown={keep} onClick={() => onPress('0')}>0</Key>
      <Key tone="cream" className="tnum" style={KEY} onMouseDown={keep} onClick={() => onPress('1')}>1</Key>
      <Key tone="cream" style={{ ...KEY, fontSize: 17 }} onMouseDown={keep} onClick={onBackspace}>⌫ 지우기</Key>
    </div>
  );
}
