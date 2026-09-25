import type { ChosungMap } from '../lib/hangul';

/**
 * 자음 매핑을 '외울 것'이 아니라 '읽을 규칙'으로 보여 준다.
 *
 * 기본 매핑은 가나다 순서 그대로다. 대표 자음만 세면 ㄱㄴㄷㄹㅁㅂㅅㅈㅎ 아홉 개가 1~9 이고,
 * 동그란 ㅇ 만 0 으로 빠진다. 거센소리·된소리는 같은 자리에서 나는 소리라 짝이 되는
 * 대표 자음에 얹는다.
 *
 * 회장이 설정에서 매핑을 바꾸면 이 표도 바뀐 값을 그대로 보여 준다.
 *
 * 모양: 종이 카드 한 장에 인쇄된 대조표 — 위 줄 자음, 아래 줄 타자기 숫자. 빠지는 ㅇ(0)은 세로줄 뒤 서류철 색 칸.
 */
export default function ChosungKey({ map, compact = false }: { map: ChosungMap; compact?: boolean }) {
  const order = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const extras = order
    .map((d) => ({ d, rest: (map[d] ?? '').slice(1) }))
    .filter((x) => x.rest.length > 0);

  const cell = (d: string, jamo: string, extra = '') => (
    <span key={d} className={`flex flex-1 flex-col items-center gap-1.5 py-1.5 ${extra}`}>
      <span className="font-typek text-[19px] leading-none text-ink">{jamo}</span>
      <span className="tnum text-[14px] font-bold leading-none text-ink-2">{d}</span>
    </span>
  );

  return (
    <div className="rounded-[4px] bg-card px-2 py-2 shadow-[var(--paper-lift)]">
      <div className="flex items-stretch">
        {order.map((d) => cell(d, (map[d] ?? '?')[0]))}
        <span className="mx-1 w-px bg-card-edge" aria-hidden />
        {cell('0', (map['0'] ?? 'ㅇ')[0], 'rounded-[3px] bg-manila')}
      </div>

      {!compact && (
        <div className="mt-2 flex flex-col gap-1 border-t border-card-edge px-1 pt-2 font-typek text-[12px] leading-[1.6] text-ink-2">
          <p>
            <b className="text-ink">가나다 순서 그대로입니다.</b> 대표 자음만 세면
            ㄱ·ㄴ·ㄷ·ㄹ·ㅁ·ㅂ·ㅅ·ㅈ·ㅎ 아홉 개가 1부터 9까지이고, 동그란 <b className="text-ink">ㅇ 만 0</b> 으로
            빠집니다. 그래서 <b className="text-ink">ㅈ 이 여덟 번째라 8</b>, <b className="text-ink">ㅎ 이 마지막이라 9</b> 입니다.
          </p>
          {extras.length > 0 && (
            <p>
              거센소리·된소리는 입에서 같은 자리에서 나는 소리라 짝에 얹습니다 —{' '}
              {extras.map((x, i) => (
                <span key={x.d}>
                  {i > 0 && ' · '}
                  {x.rest.split('').join('')} → <span className="tnum">{x.d}</span>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
