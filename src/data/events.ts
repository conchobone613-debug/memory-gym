/**
 * 기억력 대회 표준 10종목.
 *
 * 시간은 WMSC·IAM 이 쓰는 값을 적었다. 연맹과 해에 따라 다르므로 대회에 나갈 때는 그 대회
 * 요강을 봐야 한다. 여기 값은 훈련 목표를 잡는 기준으로만 쓴다.
 *
 * 한 가지 차이를 적어 둔다: 대회는 '정해진 시간 안에 최대한 많이' 인데 이 앱의 실전 모드는
 * '길이를 정해 놓고 시간을 잰다'. 방향이 반대다. 열린 종목도 이 점에서는 대회와 다르다.
 */

/*
 * 종목 등록부. 영역(기억력·계산 …)마다 종목을 한 줄씩 적는다.
 * 홈·대시보드·스승님은 이 파일만 본다 — 새 종목이나 새 영역이 생겨도 그쪽은 고치지 않는다.
 */

export type Domain = 'memory' | 'calc';

export const DOMAIN_NAME: Record<Domain, string> = { memory: '기억력', calc: '계산' };

export type EventStatus = 'ready' | 'locked';

interface DisciplineBase {
  id: string;
  domain: Domain;
  name: string;
  /** 무엇을 하는 종목인가 */
  what: string;
  status: EventStatus;
  /** 열린 종목: 어디로 가면 되는지 */
  to?: string;
  /** 잠긴 종목: 무엇이 있어야 열리는지 */
  needs?: string;
}

export interface MemoryEvent extends DisciplineBase {
  domain: 'memory';
  /** 암기 시간 표기 */
  memorize: string;
  /** 회상 시간 표기 */
  recall: string;
  /** 대회식 점수가 있는 종목 — 성적표·내 기록·스승님이 이 이름과 단위로 적는다(판마다 RecallSession.score) */
  score?: { label: string; unit: string };
  /** 종목 화면의 연습·모의 대회 설명. 없으면 화면 기본 문구 */
  howPractice?: string;
  howContest?: string;
}

/** 규정 칸 하나. 값은 설정 화면에서 바꾸고 세션마다 사본으로 남는다. */
export type RuleField =
  | { key: string; label: string; kind: 'number'; default: number; min: number; max: number; unit?: string; hint?: string }
  | { key: string; label: string; kind: 'choice'; default: string; options: { value: string; label: string }[]; hint?: string };

export interface CalcEvent extends DisciplineBase {
  domain: 'calc';
  /** 모의 대회 규정. 기본값은 요청서 값이며, 공식 규정은 회장이 확인해 덮어쓴다(기획서 §5.1). */
  rules: RuleField[];
}

export type Discipline = MemoryEvent | CalcEvent;

export const MEMORY_EVENTS: MemoryEvent[] = [
  {
    domain: 'memory',
    id: 'speed-numbers',
    name: '스피드 숫자',
    memorize: '5분',
    recall: '15분',
    what: '무작위 숫자를 최대한 많이. 두 번 시도해 좋은 쪽을 쓴다.',
    status: 'ready',
    to: '/practice?preset=d80&event=speed-numbers',
  },
  {
    domain: 'memory',
    id: 'hour-numbers',
    name: '1시간 숫자',
    memorize: '60분',
    recall: '120분',
    what: '같은 숫자 종목의 지구력 판. 궁전이 길게 필요하다.',
    status: 'ready',
    to: '/practice?preset=h-num&event=hour-numbers',
  },
  {
    domain: 'memory',
    id: 'speed-cards',
    name: '스피드 카드',
    memorize: '5분 안에 최대한 빨리',
    recall: '5분',
    what: '섞은 카드 한 벌 52장의 순서. 기억력 스포츠의 간판 종목이다.',
    status: 'ready',
    to: '/practice?preset=c52&event=speed-cards',
  },
  {
    domain: 'memory',
    id: 'spoken-numbers',
    name: '듣고 외우는 숫자',
    memorize: '초당 1개 낭독',
    recall: '5분',
    what: '눈으로 보지 못하고 귀로만 받는다. 되감기가 없어 가장 가혹한 종목으로 꼽힌다.',
    status: 'ready',
    to: '/practice?preset=sp100&event=spoken-numbers',
    score: { label: '처음 틀린 곳까지', unit: '자리' },
    howPractice: '낭독을 늦출 수 있고(1.5초·2초) 분량을 4분의 1로 줄입니다. 채점할 때 이미지 이름을 같이 보여 줍니다.',
    howContest: '초당 한 개씩 한 번만 읽습니다. 다 읽으면 곧바로 회상으로 넘어갑니다. 점수는 처음 틀린 곳까지 맞힌 자리 수입니다.',
  },
  {
    domain: 'memory',
    id: 'binary',
    name: '이진수',
    memorize: '5분',
    recall: '15분',
    what: '0과 1만 늘어선 30자리 줄을 외운다. 국가 대회는 5분, 국제 대회는 30분 판이다.',
    status: 'ready',
    to: '/practice?preset=b5&event=binary',
    score: { label: '줄 점수', unit: '점' },
    howPractice: '시간을 재지 않고 분량을 4분의 1로 줄입니다. 외우는 동안 칸마다 바꾼 숫자를 보여 줍니다.',
    howContest: '대회 규격 시간으로 잽니다. 30자리 줄마다 모두 맞으면 30점, 하나 틀리면 15점, 둘 이상이면 0점입니다.',
  },
  {
    domain: 'memory',
    id: 'hour-cards',
    name: '1시간 카드',
    memorize: '60분',
    recall: '120분',
    what: '여러 벌을 최대한 많이. 벌마다 궁전을 갈아탄다.',
    status: 'locked',
    needs: '카드 여러 벌 지원. 지금 종목 화면은 한 벌 52장까지만 낸다.',
  },
  {
    domain: 'memory',
    id: 'words',
    name: '무작위 단어',
    memorize: '15분',
    recall: '30분',
    what: '뜻 없이 늘어놓은 단어 목록. 한 개라도 틀리면 그 줄이 깎인다.',
    status: 'locked',
    needs: '한국어 명사 목록. 변환이 필요 없는 종목이라 목록만 있으면 곧장 만들 수 있다.',
  },
  {
    domain: 'memory',
    id: 'names',
    name: '이름과 얼굴',
    memorize: '15분',
    recall: '30분',
    what: '사진에 이름을 붙여 외운다. 실생활에 가장 쓸모 있는 종목이다.',
    status: 'locked',
    needs: '얼굴 사진과 이름 묶음. 회장님이 직접 넣으셔야 해서 손이 많이 간다.',
  },
  {
    domain: 'memory',
    id: 'dates',
    name: '역사적 날짜',
    memorize: '5분',
    recall: '15분',
    what: '지어낸 사건과 연도를 짝지어 외운다.',
    status: 'locked',
    needs: '사건 문장 목록. 연도는 숫자 이미지로 처리하면 된다.',
  },
  {
    domain: 'memory',
    id: 'images',
    name: '추상 이미지',
    memorize: '15분',
    recall: '30분',
    what: '말로 옮기기 어려운 무늬의 순서. 한 연맹은 흑백 무늬, 다른 연맹은 실물 사진을 쓴다.',
    status: 'locked',
    needs: '무늬 이미지 자료. 말로 못 옮기는 그림이라 이 앱의 이미지 체계와 방식이 다르다.',
  },
];

/* ── 계산 (암산 대회 MCWC 대비) ── */

/** 제한시간 0 = 아직 공식 값을 넣지 않음. 모의 대회는 시간을 재기만 하고 끊지 않는다. */
const timeLimit = (dflt: number): RuleField => ({
  key: 'timeLimitSec', label: '제한시간', kind: 'number', default: dflt, min: 0, max: 3600, unit: '초',
  hint: dflt ? undefined : '0 = 아직 공식 값을 넣지 않음',
});
const penalty: RuleField = {
  key: 'penaltyPerWrong', label: '오답 감점', kind: 'number', default: 0, min: 0, max: 100, unit: '점',
};
const items = (dflt: number): RuleField => ({
  key: 'items', label: '문항 수', kind: 'number', default: dflt, min: 1, max: 100, unit: '문제',
});
const ROUNDING: RuleField = {
  key: 'rounding', label: '끝자리', kind: 'choice', default: 'trunc',
  options: [{ value: 'trunc', label: '버림' }, { value: 'round', label: '반올림' }],
};

export const CALC_EVENTS: CalcEvent[] = [
  {
    domain: 'calc',
    id: 'calendar',
    name: '달력',
    what: '1600–2099년 무작위 날짜의 요일. 1분 안에 최대한 많이.',
    status: 'ready',
    to: '/calc/calendar/run',
    rules: [
      timeLimit(60),
      penalty,
      { key: 'yearFrom', label: '시작 연도', kind: 'number', default: 1600, min: 1600, max: 2099 },
      { key: 'yearTo', label: '끝 연도', kind: 'number', default: 2099, min: 1600, max: 2099 },
      {
        key: 'weekBase', label: '요일 번호', kind: 'choice', default: 'sun0',
        options: [{ value: 'sun0', label: '일요일 = 0' }, { value: 'mon1', label: '월요일 = 1' }],
      },
    ],
  },
  {
    domain: 'calc',
    id: 'sqrt',
    name: '제곱근',
    what: '6자리 수의 제곱근을 유효숫자 8자리까지.',
    status: 'ready',
    to: '/calc/sqrt/run',
    rules: [
      items(10), timeLimit(0), penalty,
      { key: 'digits', label: '자릿수', kind: 'number', default: 6, min: 2, max: 12, unit: '자리' },
      { key: 'sigDigits', label: '유효숫자', kind: 'number', default: 8, min: 2, max: 12, unit: '자리' },
      ROUNDING,
    ],
  },
  {
    domain: 'calc',
    id: 'surprise',
    name: '서프라이즈',
    what: '대회의 깜짝 라운드 대비. 제곱·곱셈·괄호 계산·나눗셈·덧셈을 섞는다.',
    status: 'ready',
    to: '/calc/surprise/run',
    rules: [items(10), timeLimit(0), penalty, ROUNDING],
  },
  {
    domain: 'calc',
    id: 'addition',
    name: '덧셈',
    what: '10자리 수 10개의 합.',
    status: 'ready',
    to: '/calc/addition/run',
    rules: [
      items(10), timeLimit(0), penalty,
      { key: 'digits', label: '자릿수', kind: 'number', default: 10, min: 1, max: 15, unit: '자리' },
      { key: 'terms', label: '더할 수의 개수', kind: 'number', default: 10, min: 2, max: 30, unit: '개' },
    ],
  },
  {
    domain: 'calc',
    id: 'multiplication',
    name: '곱셈',
    what: '8자리 × 8자리.',
    status: 'ready',
    to: '/calc/multiplication/run',
    rules: [
      items(10), timeLimit(0), penalty,
      { key: 'digitsA', label: '앞 수 자릿수', kind: 'number', default: 8, min: 1, max: 12, unit: '자리' },
      { key: 'digitsB', label: '뒤 수 자릿수', kind: 'number', default: 8, min: 1, max: 12, unit: '자리' },
    ],
  },
];

export const DISCIPLINES: Discipline[] = [...MEMORY_EVENTS, ...CALC_EVENTS];

/** 잠긴 종목 카드에 적는 여는 조건의 첫 문장(카드 설명은 두 줄까지). 전문은 종목 화면에 있다. */
export const needsHead = (s = '') => s.split('. ')[0].replace(/\.$/, '');

export function findDiscipline(id: string): Discipline | undefined {
  return DISCIPLINES.find((d) => d.id === id);
}
