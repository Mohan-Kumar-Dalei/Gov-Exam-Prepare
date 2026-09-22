import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FileUp,
  BookOpen,
  ListChecks,
  Timer,
  BarChart3,
  CalendarRange,
  MessageSquare,
  Flame,
  LogOut,
  Menu,
  X,
  GraduationCap,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/upload', label: 'PDF Analyzer', icon: FileUp },
  { to: '/learn', label: 'Learn', icon: BookOpen },
  { to: '/practice', label: 'Practice', icon: ListChecks },
  { to: '/mock', label: 'Mock Tests', icon: Timer },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/roadmap', label: 'Roadmap', icon: CalendarRange },
  { to: '/mentor', label: 'AI Mentor', icon: MessageSquare },
  // API keys are billing, so this only shows for the owner account.
  { to: '/settings', label: 'API Keys', icon: KeyRound, adminOnly: true },
];

function NavItems({ onNavigate, isAdmin }) {
  return (
    <nav className="space-y-1">
      {NAV.filter((n) => !n.adminOnly || isAdmin).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
            }`
          }
        >
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const signOut = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const initials = (user?.name || 'U')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-2 py-1">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white">
          <GraduationCap size={19} />
        </span>
        <div>
          <p className="text-sm font-bold leading-tight text-ink-900">AI Exam Coach</p>
          <p className="text-[11px] text-ink-500">Learn. Practise. Clear it.</p>
        </div>
      </div>

      <div className="mt-6 flex-1 overflow-y-auto">
        <NavItems onNavigate={() => setMobileOpen(false)} isAdmin={user?.role === 'admin'} />
      </div>

      <div className="mt-4">
        <LanguageSwitcher />
      </div>

      <div className="mt-3 rounded-xl border border-ink-200 bg-ink-50/70 p-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink-900">{user?.name}</p>
            <p className="flex items-center gap-1 text-[11px] text-amber-600">
              <Flame size={12} />
              {user?.streak?.current || 0} day streak
            </p>
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            className="rounded-lg p-2 text-ink-400 transition-colors hover:bg-white hover:text-rose-600"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
            <GraduationCap size={17} />
          </span>
          <span className="text-sm font-bold">AI Exam Coach</span>
        </div>
        <button onClick={() => setMobileOpen((v) => !v)} className="rounded-lg p-2 hover:bg-ink-100">
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 bg-white p-4 shadow-xl">{sidebar}</aside>
        </div>
      ) : null}

      <div className="mx-auto flex max-w-[1500px]">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-ink-200 bg-white p-4 lg:block">
          {sidebar}
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
