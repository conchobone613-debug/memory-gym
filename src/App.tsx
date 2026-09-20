import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
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
 *   기초 — 자산을 몸에 붙이는 것 (자음 → 두 자리 → 이미지). 종목과 무관한 공통 기반이다.
 *   종목 — 대회 표준 10종목. 각 종목 안에 연습과 실전이 있다.
 */
const NAV = [
  { to: '/', label: '홈', end: true },
  { to: '/assets', label: '자산' },
  { to: '/basics', label: '기초' },
  { to: '/events', label: '종목' },
  { to: '/stats', label: '대시보드' },
  { to: '/settings', label: '설정' },
];

export function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

function Shell() {
  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-4 px-4 py-5">
      <nav className="flex flex-wrap items-center gap-1.5">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `rounded-lg border px-3 py-1.5 text-sm transition ${
                isActive ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel hover:border-accent/50'
              }`
            }
          >
            {n.label}
          </NavLink>
        ))}
      </nav>
      <main className="flex-1">
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
  );
}

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
