import { useEffect } from 'react';
import { HashRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import Home from './pages/Home';
import Sets from './pages/Sets';
import SetEditor from './pages/SetEditor';
import Drill from './pages/Drill';
import Practice from './pages/Practice';
import Palaces from './pages/Palaces';
import Stats from './pages/Stats';
import Settings from './pages/Settings';
import { navLocked } from './lib/navlock';

const NAV = [
  { to: '/', label: '홈', key: '1' },
  { to: '/sets', label: '이미지 세트', key: '2' },
  { to: '/drill', label: '변환 드릴', key: '3' },
  { to: '/practice', label: '실전', key: '4' },
  { to: '/palaces', label: '궁전', key: '5' },
  { to: '/stats', label: '대시보드', key: '6' },
  { to: '/settings', label: '설정', key: '7' },
];

export function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

function Shell() {
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || navLocked()) return;
      const hit = NAV.find((n) => n.key === e.key);
      if (hit) { e.preventDefault(); navigate(hit.to); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-4 px-4 py-5">
      <nav className="flex flex-wrap items-center gap-1.5">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `rounded-lg border px-3 py-1.5 text-sm transition ${
                isActive ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel hover:border-accent/50'
              }`
            }
          >
            {n.label}
            <span className="ml-1.5 text-[10px] text-muted">{n.key}</span>
          </NavLink>
        ))}
      </nav>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sets" element={<Sets />} />
          <Route path="/sets/:setId" element={<SetEditor />} />
          <Route path="/drill" element={<Drill />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/palaces" element={<Palaces />} />
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
