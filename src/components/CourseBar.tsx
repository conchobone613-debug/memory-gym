import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { courseHref, itemLabel, markStep, playedMatches, type courseStep, type PlayedRun } from '../coach';
import { KeyLink } from './lp';
import { nextCourseIndex } from './course';

/*
 * 오늘의 코스 진행 — 코스로 연 판(주소에 &course=<행 id>&ci=<순번>)에서만 보인다.
 *   설정 화면: 맨 위에 '오늘의 코스 i/n · 항목 이름' 띠.
 *   결과 화면(sessionId 를 주면): 결과가 뜨는 순간 한 번 markStep 하고 '코스 다음 →' 남색 큰 자판.
 *   남은 항목이 없으면 '코스 마치기' → 홈. 결과 화면의 빨간 자판은 '한 판 더' 하나라 여기는 남색이다.
 *   played(이 판의 실제 설정)가 코스 항목과 다르면(설정 화면에서 칸·프리셋을 바꿈) 적지 않고 홈의 코스로 돌려보낸다.
 */

export type CourseStep = NonNullable<ReturnType<typeof courseStep>>;

export default function CourseBar({ step, sessionId, played }: { step: CourseStep | null; sessionId?: string; played?: PlayedRun }) {
  const row = useLiveQuery(() => (step ? db.coachLogs.get(step.logId) : undefined), [step?.logId]);

  /* 결과가 뜬 순간 한 번 — 같은 판을 두 번 적지 않는다(적어도 같은 값이라 해는 없다) */
  const marked = useRef('');
  useEffect(() => {
    if (!step || !sessionId || marked.current === sessionId) return;
    marked.current = sessionId;
    markStep(step.logId, step.index, sessionId, played).catch(() => { marked.current = ''; });
  }, [step?.logId, step?.index, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = row?.course?.items;
  if (!step || !items || step.index >= items.length) return null;
  const n = items.length;

  if (!sessionId) {
    return (
      <div className="rounded-[4px] border border-dashed border-card-edge bg-card px-3 py-2 font-typek text-[12.5px] text-ink">
        <b className="tnum">오늘의 코스 {step.index + 1}/{n}</b> · {itemLabel(items[step.index])}
      </div>
    );
  }

  const item = items[step.index];
  if (played && !playedMatches(item, played)) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-center font-typek text-[12px] text-ink-2">이 판은 코스 항목과 설정이 달라 코스에 적지 않았습니다.</p>
        {/* 같은 주소로 돌아가면 화면이 그대로라(달력은 주소가 곧 칸) 홈의 '이어 하기' 로 보낸다 */}
        <KeyLink to="/" size="big" sub={`${step.index + 1}/${n} · ${itemLabel(item)}`}>코스로 돌아가기</KeyLink>
      </div>
    );
  }

  /* 이번 판은 끝난 것으로 보고, 뒤쪽부터 아직 안 한 항목을 찾는다(앞에 건너뛴 것이 있으면 되돌아가 그것) */
  const done = items.map((_, i) => (i === step.index ? sessionId : row?.done?.[i] ?? null));
  const next = nextCourseIndex(done, step.index);

  if (next < 0) {
    return <KeyLink to="/" size="big" sub={`오늘의 코스 ${n}/${n}`}>코스 마치기</KeyLink>;
  }
  return (
    <KeyLink to={courseHref(items[next], step.logId, next)} size="big" sub={`${next + 1}/${n} · ${itemLabel(items[next])}`}>
      코스 다음 →
    </KeyLink>
  );
}
