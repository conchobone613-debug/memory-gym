import { keyLabelFor } from '../lib/keyjamo';

const JAMO = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/**
 * 화면으로 답하는 길.
 * 휴대폰에는 물리 키보드가 없어 이것 없이는 기초 단계를 아예 할 수 없었다.
 * 데스크탑에서도 띄워 둔다 — 자판 자리를 같이 보여 주면 손이 먼저 외운다.
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
            className="flex min-h-12 flex-col items-center justify-center rounded-lg border border-line bg-panel2 text-lg transition-colors hover:border-accent/60 active:bg-accent/20"
          >
            <span className="leading-none">{k}</span>
            {kind === 'jamo' && (
              <span className="mt-0.5 text-[9px] text-muted">{keyLabelFor(k) ?? ''}</span>
            )}
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
