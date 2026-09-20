/**
 * 기억력 대회 표준 10종목.
 *
 * 시간은 WMSC·IAM 이 쓰는 값을 적었다. 연맹과 해에 따라 다르므로 대회에 나갈 때는 그 대회
 * 요강을 봐야 한다. 여기 값은 훈련 목표를 잡는 기준으로만 쓴다.
 *
 * 한 가지 차이를 적어 둔다: 대회는 '정해진 시간 안에 최대한 많이' 인데 이 앱의 실전 모드는
 * '길이를 정해 놓고 시간을 잰다'. 방향이 반대다. 열린 종목도 이 점에서는 대회와 다르다.
 */

export type EventStatus = 'ready' | 'locked';

export interface MemoryEvent {
  id: string;
  name: string;
  /** 암기 시간 표기 */
  memorize: string;
  /** 회상 시간 표기 */
  recall: string;
  /** 무엇을 외우는 종목인가 */
  what: string;
  status: EventStatus;
  /** 열린 종목: 어디로 가면 되는지 */
  to?: string;
  /** 잠긴 종목: 무엇이 있어야 열리는지 */
  needs?: string;
}

export const MEMORY_EVENTS: MemoryEvent[] = [
  {
    id: 'speed-numbers',
    name: '스피드 숫자',
    memorize: '5분',
    recall: '15분',
    what: '무작위 숫자를 최대한 많이. 두 번 시도해 좋은 쪽을 쓴다.',
    status: 'ready',
    to: '/practice?preset=d80&event=speed-numbers',
  },
  {
    id: 'hour-numbers',
    name: '1시간 숫자',
    memorize: '60분',
    recall: '120분',
    what: '같은 숫자 종목의 지구력 판. 궁전이 길게 필요하다.',
    status: 'ready',
    to: '/practice?preset=h-num&event=hour-numbers',
  },
  {
    id: 'speed-cards',
    name: '스피드 카드',
    memorize: '5분 안에 최대한 빨리',
    recall: '5분',
    what: '섞은 카드 한 벌 52장의 순서. 기억력 스포츠의 간판 종목이다.',
    status: 'ready',
    to: '/practice?preset=c52&event=speed-cards',
  },
  {
    id: 'spoken-numbers',
    name: '듣고 외우는 숫자',
    memorize: '초당 한 개씩 낭독',
    recall: '제한 있음',
    what: '눈으로 보지 못하고 귀로만 받는다. 되감기가 없어 가장 가혹한 종목으로 꼽힌다.',
    status: 'locked',
    needs: '숫자를 초당 하나씩 읽어 주는 기능. 브라우저 음성 합성으로 만들 수 있어 사진이 필요한 종목보다 쉽다.',
  },
  {
    id: 'binary',
    name: '이진수',
    memorize: '30분',
    recall: '60분',
    what: '0과 1만 늘어선 줄을 외운다.',
    status: 'locked',
    needs: '이진수를 몇 자리씩 묶어 십진수로 바꾸는 규칙. 바꾸고 나면 회장님 숫자 이미지를 그대로 쓴다.',
  },
  {
    id: 'hour-cards',
    name: '1시간 카드',
    memorize: '60분',
    recall: '120분',
    what: '여러 벌을 최대한 많이. 벌마다 궁전을 갈아탄다.',
    status: 'locked',
    needs: '카드 여러 벌 지원. 지금 실전 모드는 한 벌 52장까지만 낸다.',
  },
  {
    id: 'words',
    name: '무작위 단어',
    memorize: '15분',
    recall: '30분',
    what: '뜻 없이 늘어놓은 단어 목록. 한 개라도 틀리면 그 줄이 깎인다.',
    status: 'locked',
    needs: '한국어 명사 목록. 변환이 필요 없는 종목이라 목록만 있으면 곧장 만들 수 있다.',
  },
  {
    id: 'names',
    name: '이름과 얼굴',
    memorize: '15분',
    recall: '30분',
    what: '사진에 이름을 붙여 외운다. 실생활에 가장 쓸모 있는 종목이다.',
    status: 'locked',
    needs: '얼굴 사진과 이름 묶음. 회장님이 직접 넣으셔야 해서 손이 많이 간다.',
  },
  {
    id: 'dates',
    name: '역사적 날짜',
    memorize: '5분',
    recall: '15분',
    what: '지어낸 사건과 연도를 짝지어 외운다.',
    status: 'locked',
    needs: '사건 문장 목록. 연도는 숫자 이미지로 처리하면 된다.',
  },
  {
    id: 'images',
    name: '추상 이미지',
    memorize: '15분',
    recall: '30분',
    what: '말로 옮기기 어려운 무늬의 순서. WMSC 는 흑백 무늬, IAM 은 실물 사진을 쓴다.',
    status: 'locked',
    needs: '무늬 이미지 자료. 말로 못 옮기는 그림이라 이 앱의 이미지 체계와 방식이 다르다.',
  },
];
