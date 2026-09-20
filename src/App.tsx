import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Home from './pages/Home';
import Assets from './pages/Assets';
import Sets from './pages/Sets';
import SetEditor from './pages/SetEditor';
import Palaces from './pages/Palaces';
import Basics from './pages/Basics';
import Events from './pages/Events';
import EventDetail from './pages/EventDetail';
import Practice from './pages/Practice';
import Stats from './pages/Stats';
import Settings from './pages/Settings';

/**
 * 층을 셋으로 나눈다.
 *   자산 — 내가 만들어 두는 것 (이미지 세트 · 궁전)
 *   기초 — 자산을 몸에 붙이는 것. 종목과 무관한 공통 기반이다.
 *   종목 — 대회 표준 10종목. 각 종목 안에 연습과 실전이 있다.
 * 데스크탑은 왼쪽 기둥에 이 층을 그대로 세우고, 모바일은 엄지가 닿는 아래 탭으로 내린다.
 */
const GROUPS: { label?: string; items: { to: string; label: string; icon: string; end?: boolean }[] }[] = [
  { items: [{ to: '/', label: '홈', icon: '⌂', end: true }] },
  { label: '준비', items: [{ to: '/assets', label: '자산', icon: '◈' }] },
  {
    label: '훈련',
    items: [
      { to: '/basics', label: '기초', icon: '◐' },
      { to: '/events', label: '종목', icon: '◆' },
    ],
  },
  {
    label: '되돌아보기',
    items: [
      { to: '/stats', label: '대시보드', icon: '▤' },
      { to: '/settings', label: '설정', icon: '⚙' },
    ],
  },
];

/** 모바일 아래 탭. 다섯 개를 넘기지 않는다. 설정은 위 머리말의 톱니로 뺀다. */
const TABS = [
  { to: '/', label: '홈', icon: '⌂', end: true },
  { to: '/assets', label: '자산', icon: '◈' },
  { to: '/basics', label: '기초', icon: '◐' },
  { to: '/events', label: '종목', icon: '◆' },
  { to: '/stats', label: '기록', icon: '▤' },
];

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

function Shell() {
  return (
    <div className="mx-auto flex min-h-full max-w-[1400px] md:gap-6">
      <ScrollTop />

      {/* 데스크탑 기둥 */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-5 border-r border-line/70 px-4 py-6 md:flex">
        <div>
          <div className="font-display text-lg leading-tight">기억력 훈련소</div>
          <div className="text-[11px] text-muted">memory gym</div>
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
          <span className="font-display text-base">기억력 훈련소</span>
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

            <Route path="/basics" element={<Basics />} />

            <Route path="/events" element={<Events />} />
            <Route path="/events/:eventId" element={<EventDetail />} />
            <Route path="/practice" element={<Practice />} />

            <Route path="/stats" element={<Stats />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>

      {/* 모바일 아래 탭 */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line/70 bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            <span aria-hidden className="text-base leading-none">{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
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
