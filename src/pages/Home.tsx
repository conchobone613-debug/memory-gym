import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, type CoachLog } from '../db/db';
import { dailyRows, localDayKey } from '../db/analytics';
import { LADDERS, goalFor } from '../db/goals';
import { dayStreak, loadSummaries } from '../db/sessions';
import { CALC_EVENTS, needsHead } from '../data/events';
import {
  courseHref, courseRowsOn, estimateMs, itemLabel, NO_USABLE_ITEMS, shouldAutoAsk, todayCourse, usageThisMonth, type CoachSummary,
} from '../coach';
import { APP_NAME, APP_NAME_KO } from '../brand';
import { Empty, Panel, Stat, fmtMs, fmtPct } from '../components/ui';
import { art, Dymo, Folder, Gauge, IndexCard, Key, KeyLink, SageNote, TearCalendar, TvVideo } from '../components/lp';
import BackupNudge from '../components/BackupNudge';
import { coachErrorText } from '../components/CoachReview';
import {
  courseJob, defaultCourseMinutes, labelParts, markOpened, MINUTE_OPTIONS, minuteOptions, nextCourseIndex, startCourseJob, type CourseJob,
} from '../components/course';

/** 기본 분량 — 하루 목표에서 오늘 채운 분을 뺀 값, 최소 5분 */
async function defaultMinutes(now: number): Promise<number> {
  const [s, sums] = await Promise.all([getSettings(), loadSummaries(new Date(now).setHours(0, 0, 0, 0))]);
  return defaultCourseMinutes(s.dailyMinutes, dayStreak(sums, now).todayMs);
}

/**
 * 오늘의 코스 — 홈에 보이는 것은 늘 오늘의 가장 최근 코스 행(todayCourse)이다.
 * 없으면 규칙 코스를 곧바로 짜서 보이고, 하루 한 번 자동 조건(shouldAutoAsk)이면 스승님께 묻는다.
 * 이미 시작한 코스는 갈아 끼우지 않으므로 그때는 묻지도 않는다.
 */
function useTodayCourse() {
  const row = useLiveQuery(() => todayCourse(), []);
  const hasKey = !!useLiveQuery(() => getSettings(), [])?.aiKey?.trim();
  /** 짜는 중인 분량(스승님께 묻는 중이면 ai) */
  const [busy, setBusy] = useState<{ minutes: number; ai: boolean } | null>(null);
  const [notice, setNotice] = useState('');

  /* 짜는 동안 '짜는 중' 을 띄우고, 끝나면 거둔다. 새 행은 live query 가 받아 띄운다 */
  const follow = useCallback((job: CourseJob) => {
    setBusy({ minutes: job.minutes, ai: job.ai });
    setNotice('');
    job.promise.catch((e) => setNotice(coachErrorText(e))).finally(() => setBusy(null));
  }, []);

  const remake = useCallback((minutes: number, useAi: boolean, base?: CoachLog, auto?: Parameters<typeof startCourseJob>[3]) => {
    if (!courseJob()) follow(startCourseJob(minutes, useAi, base, auto));
  }, [follow]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const job = courseJob();
      if (job) { follow(job); return; }
      const now = Date.now();
      const [s, rows, usage] = await Promise.all([getSettings(), courseRowsOn(now), usageThisMonth(now)]);
      if (!alive || courseJob()) return;
      const cur = rows.find((r) => !!r.course) ?? await startCourseJob(await defaultMinutes(now), false).promise;
      if (!alive) return;
      /* 자리는 remake 안에서 한 번 더 잡는다(claimAutoAsk) — 다른 창이 먼저 물었으면 묻지 않는다 */
      if (shouldAutoAsk(s, rows, usage) && !cur.done?.some((d) => d != null)) {
        remake(cur.minutes ?? s.dailyMinutes, true, cur, { settings: s, usage });
      }
    })().catch((e) => { if (alive) setNotice(coachErrorText(e)); });
    return () => { alive = false; };
  }, [follow, remake]);

  return { row, hasKey, busy, notice, remake };
}

/**
 * 스승님 서류철 — 스승님 말 · 오늘 쓸 시간 · 코스 항목 카드 · 코스 시작(또는 이어 하기) · 다시 짜기.
 * 시간을 고르거나 다시 짜기를 누르면 그 분량으로 새로 짠다(키가 있으면 스승님, 없으면 규칙).
 */
function CourseFolder({ needImages }: { needImages: boolean }) {
  const { row, hasKey, busy, notice, remake } = useTodayCourse();
  const course = row?.course;

  if (!row || !course) {
    return (
      <Folder tab="스승님" clip>
        <p className="m-0 font-typek text-[13px] text-ink-2">{notice || '오늘의 코스를 준비하는 중입니다.'}</p>
      </Folder>
    );
  }

  const items = course.items;
  const done = items.map((_, i) => row.done?.[i] ?? null);
  const next = nextCourseIndex(done);
  const started = done.some((d) => d != null);
  /* 합계는 항목별로 반올림한 분을 더하지 않고 한 번만 반올림한다(15분 코스가 '약 16분' 으로 보이지 않게) */
  const total = Math.max(1, Math.round(items.reduce((a, it) => a + estimateMs(it, row.input as CoachSummary), 0) / 60_000));
  const minutes = row.minutes ?? MINUTE_OPTIONS[2];
  const shown = busy?.minutes ?? minutes;
  const opts = minuteOptions(minutes);

  const caption = busy?.ai
    ? '스승님이 코스를 짜는 중…'
    : row.aiError === NO_USABLE_ITEMS
      ? `스승님 답을 쓸 수 없어 규칙으로 짠 ${minutes}분 코스입니다.`
      : row.aiError
        ? `스승님께 묻지 못해 규칙으로 짰습니다 — ${coachErrorText(row.aiError)}`
        : row.source === 'ai'
          ? `스승님이 짠 ${minutes}분 코스입니다.`
          : `규칙으로 짠 ${minutes}분 코스입니다.${hasKey ? '' : ' 설정에 AI 키를 넣으면 스승님이 짭니다.'}`;

  return (
    <Folder tab="스승님" clip>
      <SageNote>{course.say}</SageNote>
      <p className="mt-2 mb-0 line-clamp-2 font-typek text-[12px] leading-snug text-ink-2" role="status">{caption}</p>
      {notice && <p className="mt-1 mb-0 font-typek text-[12px] font-bold text-ink" role="status">{notice}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="오늘 쓸 시간">
        {opts.map((m) => (
          <Key
            key={m}
            size="sm"
            tone={m === shown ? 'ink' : 'cream'}
            aria-pressed={m === shown}
            disabled={!!busy}
            style={{ padding: '8px 10px 9px' }}
            className="tnum"
            onClick={() => { if (m !== minutes) remake(m, hasKey, row); }}
          >
            {m}분
          </Key>
        ))}
      </div>

      {/* 코스 항목·시작 자판을 누르면 '이 코스를 열었다' 고 적어 둔다 — 묻던 새 코스가 늦게 와도 하던 코스를 밀어내지 않게 */}
      <div onClickCapture={() => markOpened(row.id)}>
        <div className="mt-3 flex flex-col gap-2.5">
          {items.map((it, i) => {
            const [title, detail] = labelParts(it);
            return (
              <IndexCard
                key={i}
                to={courseHref(it, row.id, i)}
                title={title}
                meta={done[i] ? '마침' : `${it.estMinutes}분`}
                className={done[i] ? 'opacity-60' : undefined}
                body={<>{detail && <span className="block font-bold text-ink">{detail}</span>}{it.why}</>}
              />
            );
          })}
        </div>

        {next < 0 ? (
          items.length > 0 && <p className="mt-4 mb-0 text-center font-sign text-[20px] text-chalk">오늘 코스를 마쳤습니다</p>
        ) : (
          <KeyLink
            to={courseHref(items[next], row.id, next)}
            size="big"
            className="mt-4"
            sub={started ? itemLabel(items[next]) : `${items.length}가지 · 약 ${total}분`}
          >
            {started ? `이어 하기 ${next + 1}/${items.length}` : '오늘의 코스 시작'}
          </KeyLink>
        )}
      </div>
      <div className="mt-3 flex justify-center">
        <Key tone="cream" size="sm" disabled={!!busy} onClick={() => remake(minutes, hasKey, row)}>다시 짜기</Key>
      </div>

      {needImages && (
        <p className="mt-3 mb-0 font-typek text-[12px] leading-relaxed text-ink-2">
          이미지 이름이 아직 비어 있습니다. <Link to="/assets/sets" className="font-bold text-ink underline">이미지 세트</Link>를
          먼저 채우면 3단계와 기억력 종목을 제대로 할 수 있습니다.
        </p>
      )}
    </Folder>
  );
}

/** 둘러보는 화면 — 텔레비전 · 이름 · 오늘의 상태 · 스승님 서류철 · 다이모로 나눈 목록 카드 */
export default function Home() {
  const rows = useLiveQuery(() => dailyRows(7), [], []);
  const images = useLiveQuery(() => db.images.toArray(), [], []);
  /* 연속일을 세려면 과거로 끊김 없이 이어진 날을 봐야 해서 1년 치를 읽는다 */
  const summaries = useLiveQuery(() => loadSummaries(Date.now() - 366 * 86_400_000), [], []);
  const settings = useLiveQuery(() => getSettings(), []);
  const g1 = useLiveQuery(() => goalFor(1), []);
  const g2 = useLiveQuery(() => goalFor(2), []);
  const g3 = useLiveQuery(() => goalFor(3), []);

  const today = rows[rows.length - 1];
  const week = rows.reduce(
    (a, r) => ({ attempts: a.attempts + r.attempts, correct: a.correct + r.correct }),
    { attempts: 0, correct: 0 },
  );
  const rts = rows.filter((r) => r.medianRt > 0).map((r) => r.medianRt);
  const filled = images.filter((i) => i.name.trim()).length;

  const goals = { 1: g1, 2: g2, 3: g3 };
  const stages = LADDERS[0].levels.map((l) => ({ n: String(l.stage), name: l.name, to: l.to, g: goals[l.stage] }));
  const day = dayStreak(summaries);
  const goalMin = settings?.dailyMinutes ?? 15;
  const todayMin = Math.floor(day.todayMs / 60_000);

  return (
    <div className="flex flex-col gap-4">
      <BackupNudge />

      <TvVideo poster={art('room.webp')} webm={art('room-loop.webm')} mp4={art('room-loop.mp4')} alt="1950년대 계산실" />

      <header>
        {/* 화면 글자는 한국어 — 큰 제목은 한글 이름, 로마자는 부제 줄에 작게 */}
        <h1 className="m-0 font-sign text-[40px] leading-none text-ink">{APP_NAME}</h1>
        <p className="mt-1.5 font-typek text-xs font-bold tracking-[.08em] text-ink-2">{APP_NAME_KO} · 기억과 계산의 훈련소</p>
      </header>

      {/* 오늘의 상태 줄 */}
      <div className="grid grid-cols-[74px_1fr] items-stretch gap-2.5">
        <TearCalendar head="연속" num={day.streak} unit="일째" />
        <Gauge
          top={<>오늘 <b>{todayMin}분</b> / {goalMin}분</>}
          p={todayMin / goalMin}
          /* 달력엔 부연 칸이 없어 '오늘 했는지'를 여기서 가른다 — 1분 미만만 한 날도 안 한 날과 달리 보이게 */
          bottom={!day.doneToday
            ? (day.streak ? '오늘 하면 연속이 이어집니다' : '오늘부터 시작')
            : todayMin >= goalMin ? '오늘 목표를 채웠습니다' : `${goalMin - todayMin}분만 더 하면 오늘 목표`}
        />
      </div>

      {/* 오늘의 코스 — 스승님 말과 주 동작 하나(코스 시작) */}
      {/* 이미지 칸이 다 비어 있을 때만 세트 안내(불러오는 동안은 빈 목록이라 띄우지 않는다) */}
      <CourseFolder needImages={images.length > 0 && filled === 0} />

      <section className="flex flex-col gap-2.5">
        <Dymo tone="red" small className="self-start">기억력 종목</Dymo>
        {stages.map((s) => {
          const done = s.g?.checks.filter((c) => c.ok).length ?? 0;
          const total = s.g?.checks.length ?? 3;
          return (
            <IndexCard
              key={s.n}
              to={s.to}
              title={`${s.n}단계 · ${s.name}`}
              meta={`${done}/${total}`}
              body={s.g?.attempts
                ? `${s.g.passed ? '통과 · ' : ''}정확도 ${fmtPct(s.g.accuracy)} · 반응 ${fmtMs(s.g.medianRt)}`
                : '아직 기록 없음'}
            />
          );
        })}
      </section>

      <section className="flex flex-col gap-2.5">
        <Dymo tone="blue" small className="self-start">계산 종목</Dymo>
        {CALC_EVENTS.map((e) => {
          const locked = e.status !== 'ready';
          return (
            <IndexCard
              key={e.id}
              to={`/calc/${e.id}`}
              title={e.name}
              locked={locked}
              /* 설명은 두 줄까지 — 잠긴 종목은 여는 조건의 첫 문장만(계산 목록과 같은 문구). 잠김 도장 자리를 비운다 */
              body={<span className="line-clamp-2">{locked ? `열려면: ${needsHead(e.needs)}` : e.what}</span>}
            />
          );
        })}
      </section>

      <section className="flex flex-col gap-2.5">
        <Dymo small className="self-start">내 기록</Dymo>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="오늘 시도" value={`${today?.attempts ?? 0}문제`} sub={today?.attempts ? `정확도 ${fmtPct(today.accuracy)}` : '아직'} />
          <Stat label="이번 주" value={`${week.attempts}문제`} sub={week.attempts ? `정확도 ${fmtPct(week.correct / week.attempts)}` : '아직'} />
          <Stat label="주간 반응시간" value={fmtMs(rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0)} />
          <Stat label="채운 이미지" value={`${filled}개`} sub={`전체 ${images.length}칸`} />
        </div>

        <Panel title="최근 기록">
          {summaries.length === 0 ? (
            <Empty>아직 기록이 없습니다.</Empty>
          ) : (
            <ul className="m-0 list-none p-0">
              {summaries.slice(0, 5).map((s) => (
                <li key={s.id} className="flex items-center gap-2 border-t border-card-edge py-2 first:border-0">
                  <span className="tnum text-xs text-ink-2">{localDayKey(s.startedAt).slice(5)}</span>
                  <span className="rounded-[3px] border border-card-edge px-1.5 font-typek text-[11px] text-ink-2">
                    {s.mode === 'practice' ? '연습' : '모의 대회'}
                  </span>
                  <span className="flex-1 truncate px-1 font-typek text-[13px] text-ink">{s.title}</span>
                  <span className="tnum text-sm text-ink">{fmtPct(s.accuracy)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <details className="rounded-[4px] border border-dashed border-card-edge px-3 py-2 font-typek text-[11px] text-ink-2">
          <summary className="cursor-pointer">키보드 단축키</summary>
          <ul className="mt-2 flex list-none flex-col gap-1.5 p-0">
            <li>기초 1·2단계: 자판의 자음 키 · 숫자 키 (한/영 무관, 화면 버튼도 있음) · <kbd>Tab</kbd> 모름</li>
            <li>이미지 드릴: 이름 입력 후 <kbd>Enter</kbd> · <kbd>Tab</kbd> 모름 · <kbd>Esc</kbd> 중단 (앞 문제는 '← 앞 문제' 버튼)</li>
            <li>세트 편집: 방향키 이동 · <kbd>Enter</kbd> 저장·다음 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 다음 빈칸</li>
            <li>모의 대회: 암기 중 <kbd>Enter</kbd> 조기 종료 · 회상 중 <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 제출</li>
            <li>채점: <kbd>1</kbd>–<kbd>4</kbd> 원인 태그 · <kbd>↑</kbd><kbd>↓</kbd> 칸 이동</li>
          </ul>
        </details>
      </section>
    </div>
  );
}
