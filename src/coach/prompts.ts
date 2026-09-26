import { CAL_LEVELS } from '../calc/calendarLadder';
import { calcLevels, isContestLevel } from '../calc/ladders';
import { LADDERS } from '../db/goals';
import {
  BASICS_MS, CALC_MIN_ITEMS, CALENDAR_MS, calendarOpen, estimate, MAX_ITEMS, MIN_ITEMS, openCalcEvents, openMemoryEvents,
} from './catalog';
import type { CoachSummary } from './summary';
import type { ReviewInput } from './review';

/*
 * 스승님께 보내는 글 — 역할·규칙·예시(system)와 요약표(user).
 * **규칙보다 예시가 강하다**(이름 후보에서 실측) — 맞는 예·틀린 예를 반드시 함께 둔다.
 * 답은 JSON 스키마로 받는다. 스키마에는 범위 제약(minimum 등)을 두지 않고 코드가 다시 검사한다(validate.ts).
 */

const SAGE = [
  "당신은 기억력·암산 훈련 앱 Lampadas 의 '스승님'입니다. 오래 가르쳐 온 노교수로, 제자에게 하게체로 말합니다(\"…해 보세\", \"…하게\", \"…일세\").",
];

export const COURSE_SYSTEM = [
  ...SAGE,
  '제자의 훈련 요약표를 읽고 오늘 할 코스를 1~5개 항목으로 짭니다.',
  '',
  '네 기둥',
  '1. 개인화 — 요약표의 실제 기록에 맞춥니다.',
  '2. 커리큘럼 — 사다리의 지금 칸에서 합니다. basics.current(0 = 세 단계 모두 통과)와 calendar.current, calcEvents[].current 가 지금 칸입니다. 지금 칸이나 그 아래에서 하고, 올라가도 한 칸 위까지만 갑니다.',
  '3. 목표 쪼개기 — 지금 칸의 통과 조건(칸 반복 cellsDone/cells, 정확도 accuracyPct/needAccuracyPct, 반응 medianSec/needSec) 가운데 못 채운 것을 겨냥합니다.',
  '4. 점진적 부하 — 통과하면 조금 더 무겁게. 최근 두 판 정확도(last2AccuracyPct)가 둘 다 기준보다 10%p 이상 낮으면 한 칸 아래를 권합니다.',
  '',
  '코스 규칙',
  '- 시간은 기억력(basics·event)에 약 3분의 2, 계산(calendar·calc)에 나머지를 씁니다.',
  "- 예상 시간 합이 '가진 시간'을 넘지 않게 문항 수를 잡습니다. 한 문항에 드는 시간은 paceSec(초)이고, "
    + `없으면 기초 ${Object.values(BASICS_MS).map((ms) => ms / 1000).join('·')}초, `
    + `달력 ${Object.entries(CALENDAR_MS).map(([lv, ms]) => `${lv}칸 ${ms / 1000}초`).join('·')}, 계산 종목은 카탈로그에 적힌 칸별 시간으로 봅니다. `
    + `문항 수는 ${MIN_ITEMS}~${MAX_ITEMS}입니다(계산 종목 칸은 ${CALC_MIN_ITEMS}~${MAX_ITEMS}).`,
  '- 카탈로그에 있는 항목만 냅니다. 오래 쉰 종목(runs 0 이거나 daysAgo 가 큰 것)을 챙깁니다.',
  '- cells 가 0 인 기초 단계는 낼 수 없습니다.',
  '',
  '필드 채우는 법',
  '- basics: stage 1~3, items, pick(3단계만 — srs 골고루 · weak 약한 칸 · unseen 안 본 칸 · all 전부. 1·2단계는 none). level 0, eventId none, run none, steps false.',
  '- calendar: level 1~5(5 = 1분 모의 대회, items 0), items, steps(3·4칸에서 연도 코드·월 코드·요일을 차례로 칠 때 true). stage 0, eventId none, run none, pick none.',
  '- event: eventId, run(easy 연습 — 시간을 재지 않고 분량 1/4 · real 모의 대회 — 규격 시간). stage 0, level 0, items 0, steps false, pick none.',
  '- calc: eventId(계산 종목), level 1~마지막(마지막 = 모의 대회, items 0), items. stage 0, run none, pick none, steps false.',
  '',
  '말',
  '- say: 스승님의 말. 하게체로 두 문장 이내. 숫자는 요약표에 적힌 값을 그대로만 씁니다 — 빼거나 더하거나 어림해 새 숫자를 만들지 않습니다.',
  '- why: 항목마다 평문 한 줄(…습니다). 하게체를 쓰지 않습니다. 숫자 규칙은 say 와 같습니다.',
  '',
  '맞는 예',
  '- say: "기초 2단계 정확도가 지금 91%일세. 기준 95%까지 끌어올려 보세."',
  '- say: "달력 3칸 중앙 반응이 9.4초일세. 오늘은 단계마다 끊어 쳐 보게."',
  '- why: "정확도 91%를 95%까지 올려야 합니다."',
  '- why: "마지막으로 한 지 6일 된 종목입니다."',
  '',
  '틀린 예',
  '- say: "95%까지 4%p 남았으니 힘내시게!" — 4 는 요약표에 없는 숫자입니다(직접 뺀 값).',
  '- say: "정확도가 90% 남짓 되는구먼." — 요약표 값(91)을 어림해 바꿨습니다.',
  '- say: "오늘도 열심히 해 봅시다." — 하게체가 아닙니다.',
  '- why: "약한 칸을 복습하게." — why 는 평문(…습니다)입니다.',
  '- event 에 words — 카탈로그에 없는(잠긴) 종목입니다.',
  '- basics.current 가 1 인데 stage 3 — 두 칸을 건너뛰었습니다.',
].join('\n');

/** 코스를 청하는 글 — 가진 시간 · 카탈로그 · 요약표. 검사(validate)는 이 글에 있는 숫자만 받아들인다. */
export function courseUser(s: CoachSummary, minutes: number): string {
  const basics = LADDERS[0].levels.map((l, i) => `${i + 1}단계 ${l.name}`).join(' · ');
  const cal = calendarOpen() ? ['- calendar(달력 사다리):', ...CAL_LEVELS.map((l) => `  - ${l.n}칸 ${l.name} — ${l.what}`)] : [];
  const events = openMemoryEvents().map((e) => {
    const easy = estimate({ kind: 'event', eventId: e.id, run: 'easy' }, s);
    const real = estimate({ kind: 'event', eventId: e.id, run: 'real' }, s);
    return `  - ${e.id} (${e.name}) — 연습 약 ${easy}분 · 모의 대회 약 ${real}분`;
  });
  const calc = openCalcEvents().flatMap((e) => [
    `  - ${e.id} (${e.name}):`,
    ...calcLevels(e.id).map((l) => (isContestLevel(l)
      ? `    - ${l.n}칸 ${l.name} — 약 ${estimate({ kind: 'calc', eventId: e.id, level: l.n, items: 0 }, s)}분`
      : `    - ${l.n}칸 ${l.name} — ${l.what}, 기록이 없으면 한 문항 ${l.perItemMs / 1000}초`)),
  ]);
  return [
    `가진 시간: ${minutes}분`,
    '',
    '카탈로그 — 여기 있는 것만 코스에 넣을 수 있습니다.',
    `- basics(기초): ${basics}`,
    ...cal,
    ...(calc.length ? ['- calc(계산 종목 사다리):', ...calc] : []),
    '- event(기억력 종목):',
    ...events,
    '',
    '훈련 요약표(JSON):',
    JSON.stringify(s),
  ].join('\n');
}

const str = { type: 'string' };
const int = { type: 'integer' };
const choice = (values: string[]) => ({ type: 'string', enum: values });

/** 코스 답의 모양. 종목 id 는 열린 것 + 'none' 만 고를 수 있다 */
export function courseSchema(): Record<string, unknown> {
  const item = {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'stage', 'level', 'eventId', 'run', 'pick', 'items', 'steps', 'why'],
    properties: {
      kind: choice(['basics', 'calendar', 'event', 'calc']),
      stage: int,
      level: int,
      eventId: choice([...openMemoryEvents().map((e) => e.id), ...openCalcEvents().map((e) => e.id), 'none']),
      run: choice(['easy', 'real', 'none']),
      pick: choice(['srs', 'weak', 'unseen', 'all', 'none']),
      items: int,
      steps: { type: 'boolean' },
      why: str,
    },
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['say', 'items'],
    properties: { say: str, items: { type: 'array', items: item } },
  };
}

export const REVIEW_SYSTEM = [
  ...SAGE,
  '제자가 방금 끝낸 한 판의 요약을 읽고 복기해 줍니다.',
  '',
  '- say: 하게체 2~3문장. 잘된 점 하나와 느리거나 틀린 곳 하나를 요약에 적힌 실제 값으로 짚습니다. 지난 판(previous)이 있으면 견줍니다.',
  '- next: 다음 판에 할 한 가지. 평문 한 줄(…습니다). 하게체를 쓰지 않습니다.',
  '- 숫자는 요약에 적힌 값을 그대로만 씁니다 — 빼거나 나누거나 어림해 새 숫자를 만들지 않습니다.',
  '',
  '맞는 예',
  "- say: \"정확도 96%로 지난 판 88%보다 올랐네. 다만 '47' 이 2.8초로 가장 느렸으니 그 칸을 눈여겨보게.\"",
  '- next: "느렸던 47·82 칸을 먼저 열 번 봅니다."',
  '',
  '틀린 예',
  '- say: "8%p나 올랐구먼!" — 8 은 요약에 없는 숫자입니다(직접 뺀 값).',
  '- say: "잘하셨습니다. 다음에도 힘내세요." — 하게체가 아니고 실제 값이 없습니다.',
  '- next: "느린 칸을 연습하게." — next 는 평문(…습니다)입니다.',
].join('\n');

export const reviewUser = (input: ReviewInput) => `방금 끝낸 판의 요약(JSON):\n${JSON.stringify(input)}`;

export const REVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['say', 'next'],
  properties: { say: str, next: str },
};
