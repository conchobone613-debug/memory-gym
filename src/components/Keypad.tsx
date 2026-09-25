import { Key } from './lp';

const JAMO = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/*
 * 칸 크기 — 폭 375px 휴대폰에서 한 줄에 다섯 칸, 엄지로 누르기 좋은 크기.
 * 자판 모양(lp-key is-round)의 50px 을 덮어써야 해서 style 로 준다(부품 CSS 가 Tailwind 보다 우선한다).
 * 칸 사이는 자판 둘레 테두리(4px)와 아래 그림자가 겹치지 않을 만큼 띄운다.
 */
const CELL = { width: 56, height: 56, fontSize: 24 };
const ROW_W = 'w-[320px] max-w-full'; // 56 × 5 + 10 × 4

/**
 * 화면으로 답하는 길.
 * 휴대폰에는 물리 키보드가 없어 이것 없이는 기초 단계를 아예 할 수 없었다.
 *
 * 자판의 영문 자리(ㄱ→R)는 적지 않는다. 한글 자판에는 자음이 이미 인쇄되어 있고,
 * 정작 이 키패드가 필요한 휴대폰에는 그 R 키가 존재하지 않는다. 도움이 안 되면서
 * 매 키마다 글자를 두 배로 늘린다.
 *
 * 칸은 크림색 둥근 자판(디자인 시스템 Key 「모바일 키패드 칸」). 눌림 소리는 Key 가 낸다.
 */
export default function Keypad({
  kind,
  onPress,
  onBackspace,
}: {
  kind: 'jamo' | 'digit';
  onPress: (ch: string) => void;
  onBackspace: () => void;
}) {
  const keys = kind === 'jamo' ? JAMO : DIGITS;
  return (
    <div className="flex w-full flex-col items-center gap-4 pt-1">
      <div className={`flex flex-wrap justify-center gap-x-[10px] gap-y-[14px] ${ROW_W}`}>
        {keys.map((k) => (
          <Key
            key={k}
            tone="cream"
            size="round"
            style={CELL}
            className={kind === 'digit' ? 'tnum' : undefined}
            onClick={() => onPress(k)}
          >
            {k}
          </Key>
        ))}
      </div>
      <Key tone="cream" size="sm" className={ROW_W} onClick={onBackspace}>
        ← 지우기
      </Key>
    </div>
  );
}
