/*
 * 메뉴 아이콘 — 아이콘 글꼴·이모지를 쓰지 않고 그 시대 문구·사무용품의 윤곽을 선으로 그린다
 * (디자인 시스템 「아이콘」). 색은 글자색(currentColor)을 따른다.
 */
type P = { className?: string };
const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

/** 홈 — 횃불(Lampadas) */
export const IconTorch = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M12 3c2.2 2 3 3.6 3 5.2A3 3 0 0 1 12 11a3 3 0 0 1-3-2.8C9 6.9 10 5.6 12 3z" />
    <path d="M8.5 11.5h7l-1.6 2.5h-3.8z" />
    <path d="M10.6 14l.6 7h1.6l.6-7" />
  </svg>
);

/** 자산 — 서류철 */
export const IconFolder = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h14A1.5 1.5 0 0 0 20.5 18V9A1.5 1.5 0 0 0 19 7.5h-7.2L10 5H5a1.5 1.5 0 0 0-1.5 1.5z" />
    <path d="M3.5 10.5h17" />
  </svg>
);

/** 기억 — 도서관 목록 카드 */
export const IconCard = ({ className }: P) => (
  <svg {...base} className={className}>
    <rect x="3.5" y="5" width="17" height="14" rx="1" />
    <path d="M3.5 8.5h17" />
    <path d="M6.5 11.5h11M6.5 14h8" />
    <circle cx="12" cy="17" r=".9" />
  </svg>
);

/** 계산 — 주판 */
export const IconAbacus = ({ className }: P) => (
  <svg {...base} className={className}>
    <rect x="3.5" y="4" width="17" height="16" rx="1" />
    <path d="M3.5 9h17M3.5 14.5h17" />
    <circle cx="8" cy="6.6" r="1.2" /><circle cx="14" cy="6.6" r="1.2" />
    <circle cx="10" cy="11.8" r="1.2" /><circle cx="16" cy="11.8" r="1.2" />
    <circle cx="7" cy="17.3" r="1.2" /><circle cx="13" cy="17.3" r="1.2" />
  </svg>
);

/** 기록 — 모눈종이 위 꺾은선 */
export const IconChart = ({ className }: P) => (
  <svg {...base} className={className}>
    <rect x="3.5" y="4" width="17" height="16" rx="1" />
    <path d="M3.5 9.3h17M3.5 14.6h17M8.8 4v16M14.2 4v16" strokeOpacity=".35" />
    <path d="M5.5 17l4-5 3.5 2.5 5.5-7" />
  </svg>
);

/** 설정 — 톱니 */
export const IconGear = ({ className }: P) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
    <circle cx="12" cy="12" r="6.2" />
  </svg>
);

/** 효과음 — 탁상 종(켬) / 종 위 빗금(끔) */
export const IconBell = ({ className, off }: P & { off?: boolean }) => (
  <svg {...base} className={className}>
    <path d="M5 17h14" />
    <path d="M7 17v-3.5a5 5 0 0 1 10 0V17" />
    <path d="M12 8.5V7M10.8 7h2.4" />
    {off && <path d="M4 4l16 16" />}
  </svg>
);
