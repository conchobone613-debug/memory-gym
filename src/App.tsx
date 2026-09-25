import { HashRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings, saveSettings } from './db/db';
import { designSettings } from './design/settings';
import { APP_NAME, APP_NAME_KO } from './brand';
import { SvgDefs } from './components/lp';
import { IconAbacus, IconBell, IconCard, IconChart, IconFolder, IconGear, IconTorch } from './components/lp/icons';
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
 */
const TABS: { to: string; label: string; icon: ReactNode; match: string[] }[] = [
  { to: '/', label: '홈', icon: <IconTorch />, match: [] },
  { to: '/assets', label: '자산', icon: <IconFolder />, match: ['/assets'] },
  { to: '/memory', label: '기억', icon: <IconCard />, match: ['/memory', '/basics', '/events', '/practice'] },
  { to: '/calc', label: '계산', icon: <IconAbacus />, match: ['/calc'] },
  { to: '/stats', label: '기록', icon: <IconChart />, match: ['/stats'] },
];

function tabActive(pathname: string, t: (typeof TABS)[number]) {
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

function Shell() {
  const { pathname, search } = useLocation();
  const { sound } = useDesignSettings();

  return (
    <div className="lp-grain relative mx-auto flex min-h-dvh w-full max-w-[var(--col-w)] flex-col bg-paper shadow-[0_0_40px_#0008]">
      <SvgDefs />
      <ScrollTop />

      <header className="lp-chrome sticky top-0 z-20 flex items-center justify-between border-b border-card-edge bg-paper/95 px-3.5 py-2.5 backdrop-blur">
        <Link to="/" className="flex items-baseline gap-2 no-underline">
          <span className="font-sign text-[22px] leading-none text-ink">{APP_NAME}</span>
          <span className="font-typek text-[10px] tracking-[.12em] text-ink-2">{APP_NAME_KO}</span>
        </Link>
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label={sound ? '효과음 끄기' : '효과음 켜기'}
            aria-pressed={sound}
            onClick={() => saveSettings({ soundOn: !sound })}
            className="rounded-[4px] p-1.5 text-ink-2 hover:text-ink"
          >
            <IconBell off={!sound} />
          </button>
          <Link
            to="/settings"
            aria-label="설정"
            className={`rounded-[4px] p-1.5 ${pathname === '/settings' ? 'text-red' : 'text-ink-2 hover:text-ink'}`}
          >
            <IconGear />
          </Link>
        </span>
      </header>

      <main key={pathname} className="lp-page-in flex-1 px-3.5 pt-4 pb-28">
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

          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      {/* 아래 탭 — 기둥 폭에 맞춘다 */}
      <nav className="lp-chrome fixed bottom-0 left-1/2 z-20 grid w-full max-w-[var(--col-w)] -translate-x-1/2 grid-cols-5 border-t border-card-edge bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        {TABS.map((t) => {
          const on = tabActive(pathname, t);
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={on ? 'page' : undefined}
              className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 font-typek text-[11px] ${on ? 'font-bold text-ink' : 'text-ink-2'}`}
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
