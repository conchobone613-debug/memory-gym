import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings, type CoachLog } from '../db/db';
import { dayStreak, loadSummaries, type SessionSummary } from '../db/sessions';
import {
  cardTrend, disciplineCards, domainMinutes, exportCsv, exportFileName, exportJson, loadWeakness,
  type DayMinutes, type DisciplineCard, type Weakness,
} from '../db/insights';
import { DOMAIN_NAME, type Domain } from '../data/events';
import { buildWeeklyInput, latestWeekly, receivedThisWeek, ruleWeekly, weeklyReview, type WeeklyInput } from '../coach';
import { download } from '../lib/io';
import { agoText, fmtMin, SERIES_COLOR, shortDay } from '../lib/chart';
import { coachErrorText } from './CoachReview';
import { MinutesChart, SeriesKey, TrendLine } from './InsightCharts';
import { Dymo, Folder, Key, SageNote } from './lp';
import { Empty, Panel, Stat } from './ui';

/*
 * 기록 탭 맨 위 '종목별 기록' — 기억력·계산 두 영역을 한 화면에(기획서 §8 P7).
 * 머리 숫자 · 스승님 주간 리뷰(버튼으로만 묻는다) · 영역별 훈련 시간 · 종목 추세 · 약점 요약 · 내려받기.
 * 둘러보는 화면이라 빨간 자판은 두지 않는다.
 */

const caption = 'font-typek text-[11px] leading-relaxed text-ink-2';
const DOMAINS: Domain[] = ['memory', 'calc'];

export default function InsightsSection({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  /* 지금 시각은 읽을 때 한 번 — 화면을 그릴 때마다 시각이 바뀌어 숫자가 흔들리지 않게 */
  const base = useLiveQuery(async () => {
    const now = Date.now();
    const [summaries, weak] = await Promise.all([loadSummaries(0), loadWeakness(now)]);
    return { now, summaries, weak };
  }, []);
  const settings = useLiveQuery(() => getSettings(), []);

  const view = useMemo(() => {
    if (!base || !settings) return null;
    return {
      cards: disciplineCards(base.summaries, base.now),
      week: buildWeeklyInput(base.summaries, base.now, settings.dailyMinutes, base.weak),
      streak: dayStreak(base.summaries, base.now).streak,
    };
  }, [base, settings]);
  const minutes = useMemo(() => (base ? domainMinutes(base.summaries, days, base.now) : []), [base, days]);

  return (
    <section className="flex flex-col gap-2.5">
      <Dymo className="self-start">종목별 기록</Dymo>
      {!base || !view ? (
        <p className={caption}>기록을 읽는 중입니다.</p>
      ) : (
        <>
          <HeadStats week={view.week} streak={view.streak} />
          <WeeklyFolder week={view.week} now={base.now} hasKey={!!settings?.aiKey?.trim()} />
          <MinutesPanel rows={minutes} days={days} setDays={setDays} />
          <DisciplineList cards={view.cards} />
          <WeakPanel w={base.weak} />
          <ExportPanel summaries={base.summaries} />
        </>
      )}
    </section>
  );
}

/** 이번 주(오늘 포함 7일) 훈련 시간 두 줄 · 연속 연습일 · 이번 주 판 수 */
function HeadStats({ week, streak }: { week: WeeklyInput; streak: number }) {
  const { memory: m, calc: c } = week.domains;
  const line = (d: Domain, min: number) => (
    <span className="flex items-center gap-1.5">
      <SeriesKey d={d} />
      <span className="font-typek text-[12px] font-normal text-ink-2">{DOMAIN_NAME[d]}</span>
      <span className="text-[19px]">{min}분</span>
    </span>
  );
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="row-span-2 grid">
        <Stat
          label="이번 주 훈련 시간"
          value={<span className="mt-1 flex flex-col gap-1">{line('memory', m.minutes)}{line('calc', c.minutes)}</span>}
          sub={`${shortDay(week.week.from)}~${shortDay(week.week.to)} · 오늘 포함 7일`}
        />
      </div>
      <Stat label="연속 연습일" value={`${streak}일`} />
      <Stat label="이번 주 판 수" value={`${m.sessions + c.sessions}판`} sub={`지난주 ${m.prevSessions + c.prevSessions}판`} />
    </div>
  );
}

const receivedDay = (at: number) => {
  const d = new Date(at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

/**
 * 스승님 주간 리뷰 — 받은 리뷰가 있으면 그 말과 다음 주 할 일, 없으면 규칙 요약.
 * 묻는 것은 자판을 눌렀을 때뿐이다. 보낸 물음은 화면을 떠나도 거두지 않는다(쓴 토큰이 사용량에 남게 — 한 판 복기와 같다).
 */
function WeeklyFolder({ week, now, hasKey }: { week: WeeklyInput; now: number; hasKey: boolean }) {
  const latest = useLiveQuery(() => latestWeekly(), []);
  const [ask, setAsk] = useState<{ busy: boolean; err: string; got?: CoachLog }>({ busy: false, err: '' });
  /* 두 번 눌러도 한 번만 묻는다 — 상태는 다음 그림에야 바뀌므로 ref 로 잠근다 */
  const asking = useRef(false);

  /* 받은 답은 곧바로 — live query 가 따라오기 전에 옛 리뷰가 한 번 더 보이지 않게 */
  const row = ask.got && (!latest || ask.got.at >= latest.at) ? ask.got : latest;
  const w = row?.weekly;

  const request = async () => {
    if (asking.current) return;
    asking.current = true;
    setAsk({ busy: true, err: '' });
    try {
      const got = await weeklyReview();
      setAsk({ busy: false, err: '', got });
    } catch (e) {
      setAsk((cur) => ({ ...cur, busy: false, err: coachErrorText(e) }));
    } finally {
      asking.current = false;
    }
  };

  return (
    <Folder tab="주간 리뷰" clip>
      <SageNote>{w ? w.say : ruleWeekly(week)}</SageNote>
      {w && w.focus.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 font-typek text-[11.5px] font-bold text-ink-2">다음 주에 할 일</div>
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
            {w.focus.map((f, i) => (
              <li key={i} className="flex gap-2 rounded-[4px] bg-card px-3 py-2 font-typek text-[12.5px] leading-relaxed text-ink">
                <b className="tnum">{i + 1}</b><span className="min-w-0">{f}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className={`mt-2 mb-0 ${caption}`}>
        {w && row
          ? `스승님 주간 리뷰 · ${receivedDay(row.at)} 받음`
          : `규칙으로 쓴 요약${hasKey ? '' : ' · 설정에 AI 키를 넣으면 스승님께 주간 리뷰를 받을 수 있습니다.'}`}
      </p>
      {hasKey && (
        <div className="mt-3 flex flex-col items-center gap-1.5">
          <Key tone="cream" size="sm" disabled={ask.busy} onClick={request}>
            {ask.busy ? '스승님이 이번 주를 보는 중…' : receivedThisWeek(row, now) ? '다시 받기' : '스승님께 주간 리뷰 받기'}
          </Key>
          {ask.err && <p className="m-0 text-center font-typek text-[12px] font-bold text-ink" role="status">{ask.err}</p>}
        </div>
      )}
    </Folder>
  );
}

/** 영역별 훈련 시간(일별) — 위 '최근 기록' 과 같은 기간 고르기를 함께 쓴다 */
function MinutesPanel({ rows, days, setDays }: { rows: DayMinutes[]; days: number; setDays: (d: number) => void }) {
  const [table, setTable] = useState(false);
  const empty = rows.every((r) => r.memoryMin === 0 && r.calcMin === 0);
  return (
    <Panel
      title="영역별 훈련 시간(일별)"
      right={
        <select aria-label="그래프 기간" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7일</option><option value={14}>14일</option><option value={30}>30일</option>
        </select>
      }
    >
      {empty ? (
        <Empty>이 기간에는 훈련 기록이 없습니다.</Empty>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3 font-typek text-[12px] text-ink-2">
              {DOMAINS.map((d) => (
                <span key={d} className="flex items-center gap-1.5"><SeriesKey d={d} />{DOMAIN_NAME[d]}</span>
              ))}
            </div>
            <Key tone="cream" size="sm" aria-pressed={table} onClick={() => setTable((t) => !t)}>
              {table ? '그래프로 보기' : '표로 보기'}
            </Key>
          </div>
          {table ? <MinutesTable rows={rows} /> : <MinutesChart rows={rows} />}
        </>
      )}
    </Panel>
  );
}

function MinutesTable({ rows }: { rows: DayMinutes[] }) {
  return (
    <table className="w-full font-typek text-[13px]">
      <thead className="text-[11px] text-ink-2">
        <tr>
          <th className="py-1 text-left font-normal">날짜</th>
          <th className="text-right font-normal">기억력</th>
          <th className="text-right font-normal">계산</th>
          <th className="text-right font-normal">합계</th>
        </tr>
      </thead>
      <tbody>
        {[...rows].reverse().map((r) => (
          <tr key={r.day} className="border-t border-card-edge">
            <td className="tnum py-1.5">{shortDay(r.day)}</td>
            <td className="tnum text-right">{fmtMin(r.memoryMin)}</td>
            <td className="tnum text-right">{fmtMin(r.calcMin)}</td>
            <td className="tnum text-right text-ink-2">{fmtMin(r.memoryMin + r.calcMin)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 종목 목록 — 영역마다 다이모 머리, 종목마다 한 장 */
function DisciplineList({ cards }: { cards: DisciplineCard[] }) {
  if (!cards.length) return <Panel><Empty>종목 기록이 쌓이면 나타납니다.</Empty></Panel>;
  return (
    <>
      {DOMAINS.map((d) => {
        const list = cards.filter((c) => c.domain === d);
        if (!list.length) return null;
        return (
          <div key={d} className="flex flex-col gap-2">
            <Dymo tone={d === 'memory' ? 'red' : 'blue'} small className="mt-1 self-start">{DOMAIN_NAME[d]}</Dymo>
            {list.map((c) => <DisciplineRow key={c.id} c={c} />)}
          </div>
        );
      })}
    </>
  );
}

function DisciplineRow({ c }: { c: DisciplineCard }) {
  const t = cardTrend(c);
  const contest = c.contest.runs > 0;
  const best = contest ? c.contest.bestLabel : c.practice.bestLabel;
  const runs = [
    c.practice.runs ? `연습 ${c.practice.runs}판` : '',
    contest ? `모의 대회 ${c.contest.runs}판` : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className="rounded-[6px] bg-card px-3 pt-2.5 pb-2 shadow-[0_2px_0_var(--card-edge)]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-sign text-[18px] leading-tight text-ink">{c.name}</span>
        {best && (
          <span className="shrink-0 font-typek text-[11.5px] text-ink-2">
            {contest ? '모의 대회 최고' : '연습 최고'} <b className="tnum text-[14px] text-ink">{best}</b>
          </span>
        )}
      </div>
      <div className="mt-0.5 mb-1.5 font-typek text-[11.5px] text-ink-2">
        {runs} · 마지막 {shortDay(c.lastDay)}({agoText(c.daysAgo)})
      </div>
      <TrendLine values={t.values} days={t.days} unit={t.unit} color={SERIES_COLOR[c.domain]} label={t.label} />
    </div>
  );
}

type WeakRow = { k: string; name: string; val: string; n: string };

/** 약점 요약 — 기억력 / 계산 두 칸. 숫자는 실제 값, 표본 수와 함께 */
function WeakPanel({ w }: { w: Weakness }) {
  const blocks: { d: Domain; groups: { head: string; rows: WeakRow[] }[] }[] = [
    {
      d: 'memory',
      groups: [
        {
          head: '느린 이미지 · 중앙 반응',
          rows: w.memory.slowImages.map((x) => ({ k: x.key, name: `${x.key} ${x.name}`.trim(), val: `${x.sec.toFixed(2)}초`, n: `${x.n}회` })),
        },
        {
          head: '회상 오답 원인 · 최근 30일',
          rows: w.memory.errorTags.map((x) => ({ k: x.tag, name: x.name, val: `${x.n}번`, n: '' })),
        },
      ],
    },
    {
      d: 'calc',
      groups: [
        {
          head: '달력 느린 단계 · 최근 30일 평균',
          rows: w.calc.calendarSteps.slice(0, 3).map((x) => ({ k: x.name, name: x.name, val: `${x.sec.toFixed(2)}초`, n: `${x.n}회` })),
        },
        {
          head: '정확도 낮은 연습 · 최근 30일',
          rows: w.calc.lowAccuracy.map((x) => ({ k: x.id, name: x.name, val: `${x.accuracyPct}%`, n: `${x.n}문항` })),
        },
      ],
    },
  ];
  return (
    <Panel title="약점 요약">
      <div className="flex flex-col gap-4 font-typek text-[13px]">
        {blocks.map((b) => {
          const groups = b.groups.filter((g) => g.rows.length);
          return (
            <div key={b.d}>
              <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink"><SeriesKey d={b.d} />{DOMAIN_NAME[b.d]}</div>
              {groups.length === 0 ? (
                <p className="m-0 mt-1 text-[12.5px] text-ink-2">기록이 쌓이면 나타납니다.</p>
              ) : groups.map((g) => (
                <div key={g.head} className="mt-2">
                  <div className="mb-0.5 text-[11px] font-bold text-ink-2">{g.head}</div>
                  {g.rows.map((r) => (
                    <div key={r.k} className="flex justify-between gap-2 border-t border-card-edge py-1.5">
                      <span className="tnum min-w-0 truncate">{r.name}</span>
                      <span className="shrink-0 whitespace-nowrap">
                        <b className="tnum">{r.val}</b>
                        {r.n && <span className="text-[11px] text-ink-2"> · {r.n}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** 기록 내려받기 — 한 판이 한 줄. CSV 는 노션 표에 붙이고, JSON 은 다른 곳으로 옮길 때 */
function ExportPanel({ summaries }: { summaries: SessionSummary[] }) {
  const save = (ext: 'csv' | 'json') => {
    const now = Date.now();
    /* exportCsv 는 BOM 을 이미 붙여 내고, JSON 은 BOM 을 받지 않는 파서가 많아 둘 다 download 가 BOM 을 더하지 않게 한다 */
    if (ext === 'csv') download(exportFileName('csv', now), exportCsv(summaries), 'text/csv;charset=utf-8', false);
    else download(exportFileName('json', now), exportJson(summaries, now), 'application/json;charset=utf-8', false);
  };
  const none = summaries.length === 0;
  return (
    <Panel title="기록 내려받기">
      <p className={`m-0 ${caption}`}>
        연습·모의 대회 한 판이 한 줄입니다. CSV 는 노션 표에 그대로 붙일 수 있고, JSON 은 다른 곳으로 옮길 때 씁니다.
        AI 키와 이미지 이름은 들어가지 않습니다.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Key tone="cream" size="sm" disabled={none} aria-label="기록을 CSV 로 내려받기" onClick={() => save('csv')}>CSV</Key>
        <Key tone="cream" size="sm" disabled={none} aria-label="기록을 JSON 으로 내려받기" onClick={() => save('json')}>JSON</Key>
      </div>
    </Panel>
  );
}
