import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings } from '../db/db';
import type { Review } from '../coach';
import type { SessionKind } from '../db/sessions';
import { reviewFor, reviewSession } from '../coach';
import { Key, SageNote } from './lp';

/*
 * 스승님 복기 — 결과 화면의 크림 자판 '스승님께 복기 받기'(키가 있을 때만).
 * 누르면 그 판의 요약을 보내 한 번만 묻고(이미 받은 복기는 다시 부르지 않는다), 답은 성적표의 스승님 쪽지 자리에 들어간다.
 * 한 화면에 쪽지는 하나라 규칙 쪽지(outcome.sage)를 갈아 끼운다 — ResultSheet 의 sage 로 넘긴다.
 *
 *   const coach = useCoachReview('drill', sessionId);
 *   <ResultSheet outcome={o} sage={coach.sage} actions={<>…{coach.action}</>} />
 */

/**
 * 화면 글자는 한국어 — 연결 실패 같은 브라우저 영어 오류는 우리 말로 바꾸고, 오류 문구 뒤에 붙은 API 원문
 * (JSON·HTML, 영어 문장)은 떼어 낸다. 원문은 coachLogs 의 aiError 에 그대로 남는다.
 */
export const coachErrorText = (e: unknown): string => {
  const m = (e instanceof Error ? e.message : String(e)).split(/\s*[{[<]/)[0];
  const ko = m.split(/(?<=[.!?])\s+/).filter((x) => /[가-힣]/.test(x)).join(' ');
  return ko || '스승님과 연결하지 못했습니다. 인터넷 연결을 확인해 주십시오.';
};

/** sessionId 가 비어 있으면(기록된 문항이 없는 판) 아무것도 내지 않는다 */
export function useCoachReview(kind: SessionKind, sessionId: string): { sage?: ReactNode; action: ReactNode } {
  const hasKey = !!useLiveQuery(() => getSettings(), [])?.aiKey?.trim();
  const cached = useLiveQuery(() => (sessionId ? reviewFor(sessionId) : undefined), [sessionId]);
  /* 물음 상태는 판마다 — 새 판(한 판 더)이 되면 앞 판의 '보는 중'·오류는 저절로 사라진다 */
  const [ask, setAsk] = useState<{ id: string; busy: boolean; err: string; got?: Review }>({ id: '', busy: false, err: '' });
  const busy = ask.id === sessionId && ask.busy;
  const err = ask.id === sessionId ? ask.err : '';

  /* 받은 답은 곧바로 — live query 가 따라오기 전에 자판이 한 번 더 보이지 않게 */
  const review = cached?.review ?? (ask.id === sessionId ? ask.got : undefined);
  if (!sessionId) return { action: null };

  /*
   * 보낸 물음은 거두지 않는다 — 거두면 쓴 토큰이 coachLogs 에 남지 않아 이번 달 사용량·안전판에서 빠진다(코스와 같다).
   * 판이 바뀌거나 화면을 떠나도 답은 끝까지 받아 남기고, 화면에 띄우는 것만 그 판일 때로 한다(ask.id).
   */
  const request = async () => {
    if (busy) return;
    const id = sessionId;
    setAsk({ id, busy: true, err: '' });
    /* 늦게 온 앞 판의 답이 지금 판의 '보는 중' 을 지우지 않게 — 같은 판일 때만 바꾼다 */
    const settle = (next: typeof ask) => setAsk((cur) => (cur.id === id ? next : cur));
    try {
      /* 답은 coachLogs 에 남고 위의 live query 가 받아 쪽지로 띄운다 */
      const row = await reviewSession(kind, id);
      settle({ id, busy: false, err: '', got: row.review });
    } catch (e) {
      settle({ id, busy: false, err: coachErrorText(e) });
    }
  };

  const sage = review ? (
    <>
      <SageNote small>{review.say}</SageNote>
      {review.next && (
        <p className="m-0 rounded-[4px] bg-card px-3 py-2 font-typek text-[12.5px] leading-relaxed text-ink">
          <b>다음에 할 한 가지</b> · {review.next}
        </p>
      )}
    </>
  ) : undefined;

  const action = hasKey && !review ? (
    <div className="flex flex-col items-center gap-1.5">
      <Key tone="cream" size="sm" disabled={busy} onClick={request}>
        {busy ? '스승님이 이 판을 보는 중…' : '스승님께 복기 받기'}
      </Key>
      {err && <p className="m-0 text-center font-typek text-[12px] font-bold text-ink" role="status">{err}</p>}
    </div>
  ) : null;

  return { sage, action };
}
