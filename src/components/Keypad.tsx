const JAMO = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/**
 * 화면으로 답하는 길.
 * 휴대폰에는 물리 키보드가 없어 이것 없이는 기초 단계를 아예 할 수 없었다.
 *
 * 자판의 영문 자리(ㄱ→R)는 적지 않는다. 한글 자판에는 자음이 이미 인쇄되어 있고,
 * 정작 이 키패드가 필요한 휴대폰에는 그 R 키가 존재하지 않는다. 도움이 안 되면서
 * 매 키마다 글자를 두 배로 늘린다.
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
    <div className="w-full max-w-md">
      <div className={`grid gap-1.5 ${kind === 'jamo' ? 'grid-cols-7' : 'grid-cols-5'}`}>
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onPress(k)}
            className="flex min-h-12 items-center justify-center rounded-lg border border-line bg-panel2 text-xl leading-none transition-colors hover:border-accent/60 active:bg-accent/20"
          >
            {k}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onBackspace}
        className="mt-1.5 min-h-10 w-full rounded-lg border border-line bg-panel2 text-sm text-muted transition-colors hover:border-accent/60"
      >
        ← 지우기
      </button>
    </div>
  );
}
