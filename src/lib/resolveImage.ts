import type { AppSettings, ImageSet, MemoImage, PracticeMode } from '../db/db';
import { resolveCard } from './cards';

/**
 * 실전 칸의 정답 키가 어느 이미지였는지 찾는다.
 *
 * 채점·통계 재계산 두 곳에서 같은 답이 나와야 하므로 한 군데에만 둔다.
 * 예전에는 Practice 안에 끼어 있어 통계를 다시 만들 때 같은 규칙을 또 써야 했다.
 */
export function resolveCellImage(
  expectedKey: string,
  mode: PracticeMode,
  chunk: number,
  settings: AppSettings,
  sets: ImageSet[],
  images: MemoImage[],
): MemoImage | undefined {
  const bySetKey = new Map(images.map((i) => [`${i.setId}:${i.key}`, i]));
  const setByDomain = new Map(sets.map((s) => [s.domain, s]));

  if (mode === 'digits') {
    const set = setByDomain.get(chunk === 3 ? 'digit3' : 'digit2');
    return set ? bySetKey.get(`${set.id}:${expectedKey}`) : undefined;
  }
  const r = resolveCard(expectedKey, settings.suitDigits, settings.rankDigits);
  const set = r && setByDomain.get(r.domain);
  return r && set ? bySetKey.get(`${set.id}:${r.key}`) : undefined;
}
