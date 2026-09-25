import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { dailyRows, localDayKey } from '../db/analytics';
import { LADDERS, goalFor, type GoalStatus } from '../db/goals';
import { dayStreak, loadSummaries } from '../db/sessions';
import { getSettings } from '../db/db';
import { CALC_EVENTS, needsHead } from '../data/events';
import { APP_NAME, APP_NAME_KO } from '../brand';
import { Empty, Panel, Stat, fmtMs, fmtPct } from '../components/ui';
import { art, Dymo, Folder, Gauge, IndexCard, KeyLink, SageNote, TearCalendar, TvVideo } from '../components/lp';
import BackupNudge from '../components/BackupNudge';

interface NextStep {
  /** 스승님이 하는 말(하게체). 숫자는 코드가 계산한 값만 */
  say: string;
  to: string;
  cta: string;
  sub: string;
}


/* 못 넘은 값이 반올림으로 기준과 같은 숫자(95%·1.50초)로 찍히지 않게 — 정확도는 내리고 반응은 올린다 */
const pctDown = (x: number) => `${Math.floor(x * 100 + 1e-9)}%`;
const secUp = (ms: number) => `${(Math.ceil(ms / 10) / 100).toFixed(2)}초`;

/** 아직 못 넘은 첫 조건을 실제 값으로 한 문장. 기록이 없으면 지어내지 않고 비워 둔다. */
function gap(g?: GoalStatus): string {
  if (!g?.attempts) return '';
  const [cover, acc, rt] = g.checks;
  if (!cover.ok) return ` ${g.rule.reps}번 이상 본 칸이 ${g.total}칸 중 ${g.enough}칸일세. 남은 칸을 채워 보세.`;
  if (!acc.ok) return ` 정확도가 지금 ${pctDown(g.accuracy)}일세. ${fmtPct(g.rule.accuracy)}까지 올려 보세.`;
  if (!rt.ok && g.medianRt) return ` 반응이 지금 ${secUp(g.medianRt)}일세. ${fmtMs(g.rule.rtMs)} 안으로 줄여 보세.`;
  return '';
}

/**
 * 빈 화면에 0 을 네 개 띄우는 건 성적표지 초대장이 아니다.
 * 스승님은 '지금 무엇을 하면 되는지' 한 가지만 말한다.
 */
function pickNext(filled: number, g1?: GoalStatus, g2?: GoalStatus, g3?: GoalStatus): NextStep {
  if (filled === 0) {
    return {
      say: '먼저 숫자마다 떠올릴 이미지를 정하게. 추천 목록을 한 번에 넣을 수도 있네.',
      to: '/assets/sets',
      cta: '이미지 세트 열기',
      sub: '추천 목록을 한 번에',
    };
  }
  if (!g1?.passed) {
    return {
      say: '숫자를 보면 자음이 바로 나와야 하네. 여기가 안 붙으면 뒤가 전부 느려지네.' + gap(g1),
      to: '/basics?stage=1',
      cta: '1단계 시작',
      sub: '숫자와 자음',
    };
  }
  if (!g2?.passed) {
    return {
      say: '1단계는 통과했군. 이제 두 자리를 한 호흡에 읽어 보세.' + gap(g2),
      to: '/basics?stage=2',
      cta: '2단계 시작',
      sub: '두 자리 한 번에',
    };
  }
  if (!g3?.passed) {
    return {
      say: '자음까지 붙었군. 이제 숫자에서 곧장 이미지가 떠올라야 하네.' + gap(g3),
      to: '/basics?stage=3',
      cta: '3단계 시작',
      sub: '이미지 변환',
    };
  }
  return {
    say: '기초 세 단계를 모두 통과했군. 이제 시간을 재고 겨뤄 보세.',
    to: '/events',
    cta: '종목 고르기',
    sub: '기억력 표준 종목',
  };
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
  const next = pickNext(filled, g1, g2, g3);

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

      {/* 오늘 할 일 한 가지 — 스승님 말과 주 동작 하나 */}
      <Folder tab="스승님" clip>
        <SageNote>{next.say}</SageNote>
        <KeyLink to={next.to} size="big" sub={next.sub} className="mt-3">{next.cta}</KeyLink>
      </Folder>

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
