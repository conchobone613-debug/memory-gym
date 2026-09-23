import { codeOfName, type ChosungMap } from './hangul';

/**
 * 이름 후보를 AI 에게 물어본다.
 *
 * 서버가 없으므로 브라우저가 직접 부른다. 그래서 **키는 회장이 설정에 넣은 것만** 쓴다 —
 * 저장소가 공개라 코드에 넣으면 그대로 털리고, 기기 동기화에서도 빼 둔다(`sync/engine.ts`).
 *
 * 받은 이름은 **여기서 다시 검사한다.** 초성이 키와 안 맞는 이름은 버린다. 모델이 규칙을
 * 어길 수 있는데, 그걸 그대로 넣으면 회장이 잘못된 이름을 고르시게 된다.
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
/* 초성 제약을 지켜야 해서 값싼 모델로 내리지 않는다. 한 번에 200토큰이라 비용은 미미하다. */
const MODEL = 'claude-sonnet-5';

export interface AiAsk {
  apiKey: string;
  /** 숫자 키('12') 또는 카드 코드('SJ') */
  key: string;
  isFace: boolean;
  map: ChosungMap;
  /** 이미 쓰고 있거나 방금 보여 준 이름 — 다시 주지 않게 */
  exclude: string[];
  count?: number;
  signal?: AbortSignal;
}

function prompt({ key, isFace, map, exclude, count = 5 }: AiAsk): string {
  const skip = exclude.length ? `\n- 다음 이름은 빼 주십시오: ${exclude.join(', ')}` : '';
  if (isFace) {
    return `기억술에 쓸 '사람 이미지' 후보를 ${count}개 지어 주십시오.

- 카드 인물 한 장에 붙일 사람입니다. 초성 규칙은 없습니다.
- 직업·역할·원형처럼 **생김새가 바로 그려지는 사람**으로. 실존 인물·고유명사는 빼십시오.
- 서로 헷갈리지 않게 겹치지 않는 인상으로.${skip}

한 줄에 하나씩, 이름만 적으십시오. 번호·설명·따옴표 없이.`;
  }
  const rules = key
    .split('')
    .map((d, i) => `- ${i + 1}번째 글자의 초성: ${(map[d] ?? '?').split('').join(' 또는 ')}`)
    .join('\n');
  return `기억술에 쓸 이미지 이름 후보를 ${count}개 지어 주십시오.

초성 규칙 (반드시 지킬 것)
${rules}
- ${key.length + 1}번째 글자부터는 어떤 초성이든 좋습니다. 글자 수는 ${key.length}자 이상이면 됩니다.

그 밖의 조건
- **눈에 보이고 만질 수 있는 것**만. 추상명사·고유명사·사람 이름은 빼십시오.
- 머릿속에 그림이 바로 떠오르는 것. 짧을수록 좋습니다.
- 흔히 쓰는 말로. 사전에만 있는 낱말은 빼십시오.${skip}

한 줄에 하나씩, 이름만 적으십시오. 번호·설명·따옴표 없이.`;
}

/** 규칙을 지킨 이름만 남긴다. */
function keep(names: string[], { key, isFace, map, exclude }: AiAsk): string[] {
  const norm = (s: string) => s.replace(/\s+/g, '');
  const blocked = new Set(exclude.map(norm));
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.replace(/^[-*\d.)\s"'“”]+/, '').replace(/["'“”]+$/, '').trim();
    if (!name || name.length > 12 || !/^[가-힣 ]+$/.test(name)) continue;
    if (blocked.has(norm(name)) || out.some((o) => norm(o) === norm(name))) continue;
    if (!isFace) {
      const code = codeOfName(name, map);
      if (!code || !code.startsWith(key)) continue;
    }
    out.push(name);
  }
  return out;
}

export async function askForNames(ask: AiAsk): Promise<string[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ask.apiKey,
      'anthropic-version': '2023-06-01',
      /* 브라우저에서 직접 부르려면 이 헤더가 있어야 한다 */
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt(ask) }],
    }),
    signal: ask.signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('키가 거부되었습니다. 설정에서 다시 확인해 주십시오.');
    if (res.status === 429) throw new Error('요청이 몰렸습니다. 잠시 뒤에 다시 눌러 주십시오.');
    throw new Error(`AI 가 응답하지 않았습니다 (${res.status}). ${detail.slice(0, 120)}`);
  }

  const data = await res.json();
  const text: string = (data?.content ?? []).map((c: { text?: string }) => c.text ?? '').join('\n');
  return keep(text.split('\n'), ask);
}
