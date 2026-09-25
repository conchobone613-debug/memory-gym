import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError, callJson } from './ai';

/* 실제 API 는 부르지 않는다 — fetch 를 가짜로 바꿔 보낸 것과 받은 것만 본다 */

const reply = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stub(res: Response) {
  const f = vi.fn(async (_url: string, _init: RequestInit) => res);
  vi.stubGlobal('fetch', f);
  return f;
}

const ask = { apiKey: 'sk-test', system: '스승님', user: '요약', schema: { type: 'object' }, maxTokens: 500 };
const usage = { input_tokens: 370, output_tokens: 70 };

afterEach(() => vi.unstubAllGlobals());

describe('callJson', () => {
  it('헤더와 본문 — 키·버전·브라우저 직접 호출·생각 끄기·JSON 스키마 형식', async () => {
    const f = stub(reply({ content: [{ type: 'text', text: '{"say":"해 보세."}' }], stop_reason: 'end_turn', usage }));
    const r = await callJson(ask);
    expect(r).toEqual({ data: { say: '해 보세.' }, text: '{"say":"해 보세."}', usage: { input: 370, output: 70 } });

    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-test',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'claude-sonnet-5',
      thinking: { type: 'disabled' },
      max_tokens: 500,
      system: '스승님',
      messages: [{ role: 'user', content: '요약' }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    });
  });

  it.each([
    [401, '키가 거부되었습니다'],
    [429, '요청이 몰렸습니다'],
    [500, '(500)'],
  ])('HTTP %i 이면 알맞은 문구로 멈춘다', async (status, text) => {
    stub(reply({ error: { message: 'x' } }, status));
    const err = await callJson(ask).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).message).toContain(text);
  });

  it('빈 답은 멈추되 쓴 토큰을 들고 온다', async () => {
    stub(reply({ content: [], stop_reason: 'end_turn', usage }));
    const err = (await callJson(ask).catch((e: unknown) => e)) as AiError;
    expect(err.message).toContain('빈 답');
    expect(err.usage).toEqual({ input: 370, output: 70 });
  });

  it('잘린 답(stop_reason max_tokens)은 읽지 않는다', async () => {
    stub(reply({ content: [{ type: 'text', text: '{"say":"해 보' }], stop_reason: 'max_tokens', usage }));
    const err = (await callJson(ask).catch((e: unknown) => e)) as AiError;
    expect(err.message).toContain('잘렸습니다');
    expect(err.usage).toEqual({ input: 370, output: 70 });
  });

  it('JSON 이 아니면 앞부분을 보여 주며 멈춘다', async () => {
    stub(reply({ content: [{ type: 'text', text: '오늘은 쉬게' }], stop_reason: 'end_turn', usage }));
    const err = (await callJson(ask).catch((e: unknown) => e)) as AiError;
    expect(err.message).toContain('오늘은 쉬게');
  });
});
