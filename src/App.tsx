import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings } from './db/db';
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
import Practice from './pages/Practice';
import Stats from './pages/Stats';
import Settings from './pages/Settings';

/** 앱 이름은 가제다. 표기는 디자인 시스템의 기본값을 따르고, 2단계 공개 전에 확정한다. */
const APP_NAME = '브레인 짐';

/**
 * 영역으로 나눈다 (기획서 §4.3).
 *   자산 — 내가 만들어 두는 것 (이미지 세트 · 궁전)
 *   기억력 — 기초(공통 기반)와 종목을 나란히. 기초를 어느 한 종목 아래로 넣지 않는다.
 *   계산 — 암산 대회 종목
 * 스마트폰이 기준이다. 아래 탭 다섯이 본 메뉴이고, 데스크탑은 같은 구성을 왼쪽 기둥에 세운다.
 */
const GROUPS: { label?: string; items: { to: string; label: string; icon: string; end?: boolean }[] }[] = [
  { items: [{ to: '/', label: '홈', icon: '⌂', end: true }] },
  { label: '준비', items: [{ to: '/assets', label: '자산', icon: '◈' }] },
  {
    label: '기억력',
    items: [
      { to: '/basics', label: '기초', icon: '◐' },
      { to: '/events', label: '종목', icon: '◆' },
    ],
  },
  { label: '계산', items: [{ to: '/calc', label: '종목', icon: '∑' }] },
  {
    label: '되돌아보기',
    items: [
      { to: '/stats', label: '기록', icon: '▤' },
      { to: '/settings', label: '설정', icon: '⚙' },
    ],
  },
];

/**
 * 모바일 아래 탭. 다섯 개를 넘기지 않는다. 설정은 위 머리말의 톱니로 뺀다.
 * `match` 는 그 탭에 속한 화면들 — 기억 탭은 기초·종목·종목 실행 화면 어디서든 켜져 있어야 한다.
 */
const TABS = [
  { to: '/', label: '홈', icon: '⌂', match: [] as string[] },
  { to: '/assets', label: '자산', icon: '◈', match: ['/assets'] },
  { to: '/memory', label: '기억', icon: '◐', match: ['/memory', '/basics', '/events', '/practice'] },
  { to: '/calc', label: '계산', icon: '∑', match: ['/calc'] },
  { to: '/stats', label: '기록', icon: '▤', match: ['/stats'] },
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

function linkClass(isActive: boolean) {
  return `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
    isActive ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel2 hover:text-fg'
  }`;
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

/** 움직임 줄이기 설정을 <html data-motion> 으로 건다. 비어 있으면 기기 설정을 따른다(index.css). */
function useMotionSetting() {
  const reduce = useLiveQuery(async () => (await getSettings()).reduceMotion, []);
  useEffect(() => {
    const root = document.documentElement;
    if (reduce === undefined) delete root.dataset.motion;
    else root.dataset.motion = reduce ? 'reduce' : 'full';
  }, [reduce]);
}

function Shell() {
  const { pathname } = useLocation();
  useMotionSetting();
  return (
    <div className="mx-auto flex min-h-full max-w-[1400px] md:gap-6">
      <ScrollTop />

      {/* 데스크탑 기둥 */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-5 border-r border-line/70 px-4 py-6 md:flex">
        <div>
          <div className="font-display text-lg leading-tight">{APP_NAME}</div>
          <div className="text-[11px] text-muted">Brain Gym · 가제</div>
        </div>
        <nav className="flex flex-col gap-4">
          {GROUPS.map((g, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              {g.label && (
                <div className="px-3 pb-1 text-[10px] tracking-[0.18em] text-muted/60">{g.label}</div>
              )}
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => linkClass(isActive)}>
                  <span aria-hidden className="w-4 text-center text-accent/70">{n.icon}</span>
                  {n.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 모바일 머리말 */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line/70 bg-ink/90 px-4 py-3 backdrop-blur md:hidden">
          <span className="font-display text-base">{APP_NAME}</span>
          <NavLink
            to="/settings"
            aria-label="설정"
            className={({ isActive }) => `rounded-lg px-2 py-1 text-lg ${isActive ? 'text-accent' : 'text-muted'}`}
          >
            ⚙
          </NavLink>
        </header>

        <main className="flex-1 px-4 pt-4 pb-24 md:px-2 md:pt-8 md:pb-10">
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

            <Route path="/stats" element={<Stats />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>

      {/* 모바일 아래 탭 */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line/70 bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {TABS.map((t) => {
          const on = tabActive(pathname, t);
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={on ? 'page' : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors ${
                on ? 'text-accent' : 'text-muted'
              }`}
            >
              <span aria-hidden className="text-base leading-none">{t.icon}</span>
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
