import { HashRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings, saveSettings } from './db/db';
import { designSettings } from './design/settings';
import { APP_NAME, APP_NAME_KO } from './brand';
import { SvgDefs } from './components/lp';
import { IconAbacus, IconBell, IconCard, IconChart, IconFolder, IconGear, IconPencil, IconTorch } from './components/lp/icons';
import Home from './pages/Home';
import Assets from './pages/Assets';
import Sets from './pages/Sets';
import SetEditor from './pages/SetEditor';
import Palaces from './pages/Palaces';
import Basics from './pages/Basics';
import Events from './pages/Events';
import EventDetail from './pages/EventDetail';
import Memory from './pages/Memory';
import Calc from './pages/Calc';
import CalcDetail from './pages/CalcDetail';
import CalendarRun from './pages/CalendarRun';
import CalcRun from './pages/CalcRun';
import Practice from './pages/Practice';
import Stats from './pages/Stats';
import Settings from './pages/Settings';


/**
 * 영역으로 나눈다 (기획서 §4.3).
 *   자산 — 내가 만들어 두는 것 (이미지 세트 · 궁전)
 *   기억력 — 기초(공통 기반)와 종목을 나란히. 기초를 어느 한 종목 아래로 넣지 않는다.
 *   계산 — 암산 대회 종목
 * 스마트폰이 기준이다. 휴대폰 폭 기둥 하나를 가운데 두고, 넓은 화면에서는 바깥을 책상 색으로 채운다
 * (디자인 시스템 「화면 틀」). 아래 탭 다섯이 본 메뉴이고 설정은 머리말 톱니로 뺀다.
 * `match` 는 그 탭에 속한 화면들 — 기억 탭은 기초·종목·종목 실행 화면 어디서든 켜져 있어야 한다.
 *
 * PC 화면(가로 1024px 이상 = Tailwind `lg`, 2026-09-28 회장 지시 "PC 브라우저 버전도 함께. 내용은 동일하게")은
 * 같은 주소에서 저절로 바뀐다: 머리말·아래 탭 대신 왼쪽 메뉴(SIDE), 틀은 --frame-w 까지 넓어진다.
 * 휴대폰 화면은 한 줄도 바뀌지 않게 PC 모양은 전부 `lg:` 로만 얹는다.
 */
type NavItem = { to: string; label: string; icon: ReactNode; match: string[] };

const TABS: NavItem[] = [
  { to: '/', label: '홈', icon: <IconTorch />, match: [] },
  { to: '/assets', label: '자산', icon: <IconFolder />, match: ['/assets'] },
  { to: '/memory', label: '기억', icon: <IconCard />, match: ['/memory', '/basics', '/events', '/practice'] },
  { to: '/calc', label: '계산', icon: <IconAbacus />, match: ['/calc'] },
  { to: '/stats', label: '기록', icon: <IconChart />, match: ['/stats'] },
];

/**
 * PC 왼쪽 메뉴 — 기획서 §4.3 「데스크톱 왼쪽 기둥」 묶음. 화면·내용은 휴대폰과 같고 묶는 법만 다르다.
 * 기억력의 기초와 종목을 바로 보이게 둔다(휴대폰은 '기억' 갈림길을 한 번 거친다). 갈림길 화면은 '기억력' 제목이 연다.
 */
const SIDE: { group?: string; to?: string; items: NavItem[] }[] = [
  { items: [{ to: '/', label: '홈', icon: <IconTorch />, match: [] }] },
  { group: '준비', items: [{ to: '/assets', label: '자산', icon: <IconFolder />, match: ['/assets'] }] },
  {
    group: '기억력',
    to: '/memory',
    items: [
      { to: '/basics', label: '기초', icon: <IconPencil />, match: ['/basics'] },
      { to: '/events', label: '종목', icon: <IconCard />, match: ['/events', '/practice'] },
    ],
  },
  { group: '계산', items: [{ to: '/calc', label: '종목', icon: <IconAbacus />, match: ['/calc'] }] },
  {
    group: '되돌아보기',
    items: [
      { to: '/stats', label: '기록', icon: <IconChart />, match: ['/stats'] },
      { to: '/settings', label: '설정', icon: <IconGear />, match: ['/settings'] },
    ],
  },
];

function tabActive(pathname: string, t: NavItem) {
  if (t.to === '/') return pathname === '/';
  return t.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

export function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

/**
 * 소리·움직임 설정을 연출 모듈(design/settings)과 <html data-motion> 에 건다.
 * 움직임 줄이기를 비워 두면 기기 설정(prefers-reduced-motion)을 따른다.
 */
function useDesignSettings() {
  const s = useLiveQuery(() => getSettings(), []);
  const reduce = s?.reduceMotion;
  const sound = s?.soundOn !== false;
  useEffect(() => {
    designSettings.reduceMotion = reduce;
    designSettings.sound = sound;
    const root = document.documentElement;
    if (reduce === undefined) delete root.dataset.motion;
    else root.dataset.motion = reduce ? 'reduce' : 'full';
  }, [reduce, sound]);
  return { sound };
}

function SoundButton({ sound }: { sound: boolean }) {
  return (
    <button
      type="button"
      aria-label={sound ? '효과음 끄기' : '효과음 켜기'}
      aria-pressed={sound}
      onClick={() => saveSettings({ soundOn: !sound })}
      className="rounded-[4px] p-1.5 text-ink-2 hover:text-ink"
    >
      <IconBell off={!sound} />
    </button>
  );
}

/** PC 왼쪽 메뉴. 모의 대회·측정 중에는 머리말·아래 탭처럼 내려간다(lp-chrome, useFocusMode). */
function SideNav({ pathname, sound }: { pathname: string; sound: boolean }) {
  return (
    <aside className="lp-chrome sticky top-0 hidden h-dvh w-[var(--side-w)] shrink-0 flex-col overflow-y-auto border-r border-card-edge px-4 pt-6 pb-5 lg:flex">
      <div className="flex items-start justify-between gap-2 px-2">
        <Link to="/" className="flex flex-col no-underline">
          <span className="font-sign text-[30px] leading-none text-ink">{APP_NAME}</span>
          <span className="mt-1.5 font-typek text-[13px] tracking-[.12em] text-ink-2">{APP_NAME_KO}</span>
        </Link>
        <SoundButton sound={sound} />
      </div>

      <nav aria-label="주 메뉴" className="mt-7 flex flex-col gap-4">
        {SIDE.map((g, gi) => {
          const headOn = !!g.to && pathname === g.to;
          return (
            <div key={gi} className="flex flex-col gap-0.5">
              {g.group && (g.to ? (
                <Link
                  to={g.to}
                  aria-current={headOn ? 'page' : undefined}
                  className={`px-2 pb-1 font-typek text-[13px] tracking-[.14em] no-underline ${headOn ? 'font-bold text-red' : 'text-ink-2 hover:text-ink'}`}
                >
                  {g.group}
                </Link>
              ) : (
                <span className="px-2 pb-1 font-typek text-[13px] tracking-[.14em] text-ink-2">{g.group}</span>
              ))}
              {g.items.map((t) => {
                const on = tabActive(pathname, t);
                return (
                  <Link
                    key={t.to}
                    to={t.to}
                    aria-current={on ? 'page' : undefined}
                    className={`relative flex items-center gap-2.5 rounded-[4px] py-2 pr-2 pl-3 font-typek text-[14px] no-underline ${
                      on ? 'bg-card font-bold text-ink shadow-[0_1px_0_var(--card-edge)]' : 'text-ink-2 hover:bg-card/60 hover:text-ink'
                    }`}
                  >
                    {on && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[2px] bg-red" />}
                    {t.icon}
                    {t.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function Shell() {
  const { pathname, search } = useLocation();
  const { sound } = useDesignSettings();

  return (
    <div className="lp-grain relative mx-auto flex min-h-dvh w-full max-w-[var(--frame-w)] flex-col bg-paper shadow-[0_0_40px_#0008] lg:flex-row">
      <SvgDefs />
      <ScrollTop />

      <header className="lp-chrome sticky top-0 z-20 flex items-center justify-between border-b border-card-edge bg-paper/95 px-3.5 py-2.5 backdrop-blur lg:hidden">
        <Link to="/" className="flex items-baseline gap-2 no-underline">
          <span className="font-sign text-[22px] leading-none text-ink">{APP_NAME}</span>
          <span className="font-typek text-[12px] tracking-[.12em] text-ink-2">{APP_NAME_KO}</span>
        </Link>
        <span className="flex items-center gap-1">
          <SoundButton sound={sound} />
          <Link
            to="/settings"
            aria-label="설정"
            className={`rounded-[4px] p-1.5 ${pathname === '/settings' ? 'text-red' : 'text-ink-2 hover:text-ink'}`}
          >
            <IconGear />
          </Link>
        </span>
      </header>

      <SideNav pathname={pathname} sound={sound} />

      {/* PC 본문: 폭은 틀이 정하고(--frame-w − 왼쪽 메뉴), 화면마다 lg: 로 여러 단을 짠다 */}
      <main key={pathname} className="lp-page-in min-w-0 flex-1 px-3.5 pt-4 pb-28 lg:px-10 lg:pt-8 lg:pb-16">
        <Routes>
          <Route path="/" element={<Home />} />

          <Route path="/assets" element={<Assets />} />
          <Route path="/assets/sets" element={<Sets />} />
          <Route path="/assets/sets/:setId" element={<SetEditor />} />
          <Route path="/assets/palaces" element={<Palaces />} />

          <Route path="/memory" element={<Memory />} />
          <Route path="/basics" element={<Basics />} />

          <Route path="/events" element={<Events />} />
          <Route path="/events/:eventId" element={<EventDetail />} />
          <Route path="/practice" element={<Practice />} />

          <Route path="/calc" element={<Calc />} />
          <Route path="/calc/:id" element={<CalcDetail />} />
          {/* 칸·모드는 주소로 받으므로, 주소만 바뀌어도(뒤로 가기 등) 새 화면으로 연다 */}
          <Route path="/calc/calendar/run" element={<CalendarRun key={search} />} />
          <Route path="/calc/:id/run" element={<CalcRun key={search} />} />

          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      {/* 아래 탭 — 기둥 폭에 맞춘다. PC 는 왼쪽 메뉴가 대신한다 */}
      <nav className="lp-chrome fixed bottom-0 left-1/2 z-20 grid w-full max-w-[var(--col-w)] -translate-x-1/2 grid-cols-5 border-t border-card-edge bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {TABS.map((t) => {
          const on = tabActive(pathname, t);
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={on ? 'page' : undefined}
              className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 font-typek text-[13px] ${on ? 'font-bold text-ink' : 'text-ink-2'}`}
            >
              {on && <span aria-hidden className="absolute top-0 h-[3px] w-8 rounded-b-[2px] bg-red" />}
              {t.icon}
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
