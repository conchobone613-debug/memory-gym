import type { AppSettings, ImageSet, MemoImage, PracticeMode, RecallSession } from '../db/db';
import { resolveCard } from './cards';
import { bitsToKey, DEFAULT_BINARY_CODE, toBinaryCode } from './binary';

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
  if (mode === 'binary') {
    /* 이진수 6자리 = 두 자리 숫자 이미지 하나 */
    const key = bitsToKey(expectedKey, settings.binaryCode ?? DEFAULT_BINARY_CODE);
    const set = setByDomain.get('digit2');
    return key && set ? bySetKey.get(`${set.id}:${key}`) : undefined;
  }
  const r = resolveCard(expectedKey, settings.suitDigits, settings.rankDigits);
  const set = r && setByDomain.get(r.domain);
  return r && set ? bySetKey.get(`${set.id}:${r.key}`) : undefined;
}

/** 지난 판을 읽을 때의 설정 — 이진수 판은 그때 쓴 변환 방식(params.code)을 덮는다. 방식을 나중에 바꿔도 옛 판은 그때 방식이다. */
export function settingsForSession(settings: AppSettings, session: Pick<RecallSession, 'mode' | 'params'>): AppSettings {
  if (session.mode !== 'binary' || session.params?.code === undefined) return settings;
  return { ...settings, binaryCode: toBinaryCode(session.params.code, settings.binaryCode ?? DEFAULT_BINARY_CODE) };
}
