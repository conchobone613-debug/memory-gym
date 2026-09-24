import { codeOfName, type ChosungMap } from './hangul';

/**
 * 이름 후보를 AI 에게 물어본다.
 *
 * 서버가 없으므로 브라우저가 직접 부른다. 그래서 **키는 회장이 설정에 넣은 것만** 쓴다 —
 * 저장소가 공개라 코드에 넣으면 그대로 털리고, 기기 동기화·백업 파일에서도 빼 둔다
 * (`sync/engine.ts` 의 collectAssets, `lib/io.ts` 의 exportBackup).
 *
 * 받은 이름은 **여기서 다시 검사한다.** 초성이 키와 안 맞으면 버린다. 모델이 규칙을
 * 어길 수 있는데, 그걸 그대로 넘기면 회장이 틀린 이름을 고르시게 된다.
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
/* 초성 제약을 지켜야 해서 값싼 모델로 내리지 않는다. 한 번에 100여 토큰이라 비용은 미미하다. */
const MODEL = 'claude-sonnet-5';

/*
 * 보여 드릴 개수보다 **이만큼 더** 청한다.
 *
 * 모델이 초성 규칙을 심심찮게 흘리는데, 아래 keep() 이 그걸 걸러내므로 5개만 청하면
 * 손에 남는 게 두세 개다. 넉넉히 받아 통과한 것 중 앞에서 다섯만 보여 드린다.
 * 답이 '한 줄에 낱말 하나' 라서 세 개를 더 받아도 토큰은 거의 안 는다.
 */
const EXTRA = 3;

export interface AiAsk {
  apiKey: string;
  /** 숫자 키('12') 또는 카드 코드('SJ') */
  key: string;
  isFace: boolean;
  map: ChosungMap;
  /** 이미 쓰고 있거나 방금 보여 준 이름 — 다시 주지 않게 */
  exclude: string[];
  /** 규칙을 통과해 **보여 드릴** 개수. 실제로 청하는 개수는 이보다 EXTRA 만큼 많다. */
  count?: number;
  signal?: AbortSignal;
}

function prompt({ key, isFace, map, exclude, count = 5 }: AiAsk): string {
  const skip = exclude.length ? `\n빼 주십시오: ${exclude.slice(0, 60).join(', ')}` : '';

  if (isFace) {
    return [
      `기억술 카드에 붙일 '사람 이미지' 후보를 ${count}개 지어 주십시오.`,
      '',
      '- 초성 규칙은 없습니다.',
      '- 직업·역할·원형처럼 **생김새가 바로 그려지는 사람**으로. 실존 인물·고유명사는 빼십시오.',
      '- 맞는 예: 대장장이 · 잠수부 · 우체부 · 광대',
      `- 서로 인상이 겹치지 않게.${skip}`,
      '',
      '답은 한 줄에 하나씩 낱말만 적으십시오. 인사말·설명·번호 없이.',
    ].join('\n');
  }

  const rules = key
    .split('')
    .map((d, i) => `- ${i + 1}번째 음절의 첫소리: ${(map[d] ?? '?').split('').join(' 또는 ')}`)
    .join('\n');

  /*
   * 예시를 반드시 넣는다. 규칙만 적어 두면 모델이 '글자' 를 '낱말' 로 읽어
   * '고양이 눈동자' 같은 두 낱말을 내놓는다 (실측). 틀린 예가 그걸 막는다.
   */
  return [
    `'${key}' 칸에 쓸 기억술 이미지 이름 후보를 ${count}개 지어 주십시오.`,
    '',
    '규칙 — **띄어쓰기 없는 한 낱말**이고, 음절(글자)마다 첫소리가 정해져 있습니다.',
    rules,
    `- ${key.length + 1}번째 음절부터는 무엇이든 좋습니다.`,
    '',
    '맞는 예: 그네(그=ㄱ, 네=ㄴ) · 기념비(기=ㄱ, 념=ㄴ)',
    "틀린 예: '고양이 눈동자' — 두 낱말입니다. / '고래' — 둘째 음절 '래' 의 첫소리가 ㄹ 입니다.",
    '',
    `그 밖의 조건: 눈에 보이고 만질 수 있는 것만. 추상명사·고유명사 금지. 짧을수록 좋습니다.${skip}`,
    '',
    '답은 한 줄에 하나씩 낱말만 적으십시오. 인사말·설명·번호 없이.',
  ].join('\n');
}

/** 규칙을 지킨 이름만 남긴다. */
function keep(lines: string[], { key, isFace, map, exclude }: AiAsk): string[] {
  const norm = (s: string) => s.replace(/\s+/g, '');
  const blocked = new Set(exclude.map(norm));
  const out: string[] = [];

  for (const line of lines) {
    /* 줄 전체가 한글이길 요구하지 않는다 — '고니 (물새)' 처럼 군말이 붙어도 앞 낱말만 쓴다 */
    const name = (line.match(/[가-힣]+/) ?? [''])[0];
    if (!name || name.length > 12) continue;
    if (blocked.has(norm(name)) || out.some((o) => norm(o) === norm(name))) continue;
    if (!isFace) {
      const code = codeOfName(name, map);
      if (!code || !code.startsWith(key)) continue;
    }
    out.push(name);
  }
  return out;
}

/** 답에서 낱말만 뽑는다 — 규칙을 어겼어도 '이건 빼 주십시오' 로 되돌려 주기 위해. */
function wordsIn(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => (line.match(/[가-힣]+/) ?? [''])[0])
    .filter((w) => w && w.length <= 12);
}

/** 한 번 청한다. */
async function once(ask: AiAsk): Promise<{ names: string[]; raw: string }> {
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
      /*
       * 생각을 끈다. 켜 두면 300토큰을 생각에 다 쓰고 답을 한 글자도 못 낸다
       * (실측: thinking_tokens 297, text 블록 0개). 이름 몇 개 짓는 데 생각은 필요 없다.
       */
      thinking: { type: 'disabled' },
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
  const raw: string = (data?.content ?? [])
    .map((c: { type?: string; text?: string }) => c.text ?? '')
    .join('\n');
  if (!raw.trim()) throw new Error('AI 가 빈 답을 보냈습니다. 한 번 더 눌러 주십시오.');

  return { names: keep(raw.split('\n'), ask), raw };
}

export async function askForNames(ask: AiAsk): Promise<{ names: string[]; raw: string }> {
  const want = ask.count ?? 5;
  const first = await once({ ...ask, count: want + EXTRA });
  if (first.names.length > 0) return { names: first.names.slice(0, want), raw: first.raw };

  /*
   * 하나도 안 남으면 **여기서 알아서 한 번 더** 청한다. 빈손은 모델이 규칙을 흘린 것이지
   * 회장 잘못이 아닌데, '다시 눌러 주십시오' 는 그 뒷수습을 회장께 떠넘기는 말이다.
   * 방금 받은 틀린 낱말은 빼 달라고 같이 넘겨, 같은 답이 또 오지 않게 한다.
   * 두 번까지만이다 — 더 돌면 버튼이 언제 끝날지 모르는 것이 된다.
   */
  const again = await once({
    ...ask,
    count: want + EXTRA,
    exclude: [...ask.exclude, ...wordsIn(first.raw)],
  });
  return { names: again.names.slice(0, want), raw: again.raw };
}
