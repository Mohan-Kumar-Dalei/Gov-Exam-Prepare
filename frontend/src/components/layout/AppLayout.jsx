import { Suspense, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FileUp,
  BookOpen,
  ListChecks,
  Timer,
  FileClock,
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
import { useAsync } from '../../hooks/useAsync.js';
import { Spinner } from '../ui/index.jsx';
import { keyApi } from '../../api/endpoints.js';
import LanguageSwitcher from './LanguageSwitcher.jsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/upload', label: 'PDF Analyzer', icon: FileUp },
  { to: '/learn', label: 'Learn', icon: BookOpen },
  { to: '/practice', label: 'Practice', icon: ListChecks },
  { to: '/mock', label: 'Mock Tests', icon: Timer },
  { to: '/papers', label: 'Previous Papers', icon: FileClock },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/roadmap', label: 'Roadmap', icon: CalendarRange },
  { to: '/mentor', label: 'AI Mentor', icon: MessageSquare },
  // Everyone brings their own key, so this is a personal setting.
  { to: '/settings', label: 'API Key', icon: KeyRound },
];

/**
 * Icon-only navigation for tablet widths.
 *
 * Between md and lg there was no persistent navigation at all: the sidebar
 * starts at lg, so a tablet fell back to the phone's hamburger even though it
 * has room to spare. A rail keeps every destination one tap away without
 * spending the width a labelled sidebar needs.
 */
function NavRail({ isAdmin }) {
  return (
    <nav className="flex flex-col items-center gap-1">
      {NAV.filter((n) => !n.adminOnly || isAdmin).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          title={label}
          aria-label={label}
          className={({ isActive }) =>
            `grid h-11 w-11 place-items-center rounded-xl transition-colors ${
              isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-500 hover:bg-ink-100 hover:text-ink-900'
            }`
          }
        >
          <Icon size={19} />
        </NavLink>
      ))}
    </nav>
  );
}

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

/**
 * Loading state for a page chunk, shown inside the content area.
 *
 * Pages are lazily loaded, and the Suspense boundary used to sit above this
 * layout — so every first visit to a tab blanked the whole window, sidebar
 * included, and read as a full page reload. Suspending inside the content
 * region instead leaves the navigation where it is.
 */
function ContentLoader() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <span className="flex items-center gap-2 text-sm text-ink-500">
        <Spinner /> Loading…
      </span>
    </div>
  );
}

/**
 * Prompts an account that has no usable key to add one.
 *
 * Every learner brings their own Gemini key, so having none is the normal
 * first-run state. Without this the first sign of it is a failure part-way
 * into a lesson or a quiz, which reads as the app being broken rather than as
 * a step the learner has not taken yet.
 */
function NoKeyBanner() {
  const ring = useAsync(() => keyApi.list(), []);
  const data = ring.data?.data;

  // Say nothing until we know: a banner that flashes on every page load is
  // worse than one that appears a moment late.
  if (ring.loading || ring.error || !data) return null;
  if (data.usableCount > 0) return null;

  const hasKeys = (data.keys || []).length > 0;

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center">
      <KeyRound size={18} className="shrink-0 text-amber-600" />
      <p className="min-w-0 flex-1 text-sm text-amber-900">
        {hasKeys ? (
          <>
            <strong>None of your API keys can be used right now.</strong> They have run out of
            quota, or were rejected. AI features stay off until one works again.
          </>
        ) : (
          <>
            <strong>Add your Gemini API key to switch on the AI features.</strong> This app runs on
            your own key, so your usage is yours alone. Creating one is free.
          </>
        )}
      </p>
      <NavLink
        to="/settings"
        className="btn-primary shrink-0 justify-center whitespace-nowrap sm:w-auto"
      >
        {hasKeys ? 'Check your keys' : 'Add a key'}
      </NavLink>
    </div>
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
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
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
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink-900/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 bg-white p-4 shadow-xl">{sidebar}</aside>
        </div>
      ) : null}

      <div className="flex">
        {/* Tablet: icons only. Desktop: the full labelled sidebar. */}
        <aside className="sticky top-0 hidden h-screen w-[68px] shrink-0 flex-col items-center gap-4 border-r border-ink-200 bg-white py-4 md:flex lg:hidden">
          <NavLink to="/dashboard" className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">
            <GraduationCap size={19} />
          </NavLink>
          <div className="flex-1 overflow-y-auto">
            <NavRail isAdmin={user?.role === 'admin'} />
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            aria-label="Sign out"
            className="grid h-10 w-10 place-items-center rounded-xl text-ink-400 transition-colors hover:bg-ink-100 hover:text-rose-600"
          >
            <LogOut size={17} />
          </button>
        </aside>

        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-ink-200 bg-white p-4 lg:block xl:w-64">
          {sidebar}
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 xl:px-10 2xl:px-14">
          <NoKeyBanner />
          {/* Suspend here, not above the layout, so a tab switch swaps only
              this region and the sidebar stays put. */}
          <Suspense fallback={<ContentLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
