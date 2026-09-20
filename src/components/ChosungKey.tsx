import type { ChosungMap } from '../lib/hangul';

/**
 * 자음 매핑을 '외울 것'이 아니라 '읽을 규칙'으로 보여 준다.
 *
 * 기본 매핑은 가나다 순서 그대로다. 대표 자음만 세면 ㄱㄴㄷㄹㅁㅂㅅㅈㅎ 아홉 개가 1~9 이고,
 * 동그란 ㅇ 만 0 으로 빠진다. 거센소리·된소리는 같은 자리에서 나는 소리라 짝이 되는
 * 대표 자음에 얹는다.
 *
 * 회장이 설정에서 매핑을 바꾸면 이 표도 바뀐 값을 그대로 보여 준다.
 */
export default function ChosungKey({ map, compact = false }: { map: ChosungMap; compact?: boolean }) {
  const order = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const extras = order
    .map((d) => ({ d, rest: (map[d] ?? '').slice(1) }))
    .filter((x) => x.rest.length > 0);

  return (
    <div className="rounded-lg border border-line bg-panel2 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {order.map((d) => (
          <span key={d} className="flex flex-col items-center rounded-md border border-line px-2 py-1">
            <span className="text-lg leading-none">{(map[d] ?? '?')[0]}</span>
            <span className="tnum text-[11px] text-accent">{d}</span>
          </span>
        ))}
        <span className="px-1 text-muted">·</span>
        <span className="flex flex-col items-center rounded-md border border-accent/60 bg-accent/10 px-2 py-1">
          <span className="text-lg leading-none">{(map['0'] ?? 'ㅇ')[0]}</span>
          <span className="tnum text-[11px] text-accent">0</span>
        </span>
      </div>

      {!compact && (
        <div className="mt-2 flex flex-col gap-1 text-xs text-muted">
          <p>
            <b className="text-fg">가나다 순서 그대로입니다.</b> 대표 자음만 세면
            ㄱ·ㄴ·ㄷ·ㄹ·ㅁ·ㅂ·ㅅ·ㅈ·ㅎ 아홉 개가 1부터 9까지이고, 동그란 <b className="text-fg">ㅇ 만 0</b> 으로
            빠집니다. 그래서 <b className="text-fg">ㅈ 이 여덟 번째라 8</b>, <b className="text-fg">ㅎ 이 마지막이라 9</b> 입니다.
          </p>
          {extras.length > 0 && (
            <p>
              거센소리·된소리는 입에서 같은 자리에서 나는 소리라 짝에 얹습니다 —{' '}
              {extras.map((x, i) => (
                <span key={x.d}>
                  {i > 0 && ' · '}
                  {x.rest.split('').join('')} → {x.d}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
