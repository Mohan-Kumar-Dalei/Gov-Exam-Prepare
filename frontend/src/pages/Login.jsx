import { useState } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  GraduationCap,
  Mail,
  Lock,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Languages,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Button } from '../components/ui/index.jsx';

export function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_1fr] xl:grid-cols-[1.15fr_1fr]">
      {/*
        The showcase panel. It only appears from lg upward: below that the
        viewport belongs to the form, and a marketing column would push the
        first field below the fold on a phone.
      */}
      <div className="relative hidden overflow-hidden bg-ink-900 p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full bg-brand-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-36 -left-20 h-96 w-96 rounded-full bg-violet-500/20 blur-3xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />

        <div className="relative flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-900/40">
            <GraduationCap size={22} />
          </span>
          <span className="text-lg font-bold tracking-tight">AI Exam Coach</span>
        </div>

        <div className="relative max-w-lg">
          <h2 className="text-3xl font-bold leading-[1.15] tracking-tight xl:text-[2.6rem]">
            Upload one notification PDF.
            <span className="block bg-gradient-to-r from-brand-300 to-violet-300 bg-clip-text text-transparent">
              Get an entire preparation system.
            </span>
          </h2>

          <ul className="mt-9 space-y-3.5 text-sm text-ink-300 xl:text-[15px]">
            {[
              'Syllabus, pattern, vacancies and dates extracted automatically',
              'Lessons, notes, tricks and worked examples for every topic',
              'Previous-year papers to revise, with answers and explanations',
              'Adaptive quizzes that chase your weak topics',
              'A 60-day roadmap and an AI mentor that knows your scores',
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-500/20">
                  <Check size={12} className="text-brand-300" />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-6 text-xs text-ink-400">
          <span className="flex items-center gap-1.5">
            <Languages size={14} /> English · Hinglish · ଓଡ଼ିଆ
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={14} /> Built on real exam patterns
          </span>
        </div>
      </div>

      <div className="flex items-center justify-center px-5 py-10 sm:px-10 sm:py-14">
        {/*
          Between sm and lg the showcase panel is hidden, which would leave the
          form floating alone on a wide white field. A card gives it an edge to
          sit against. On a phone that border only steals width, and from lg the
          panel does the framing, so it is dropped at both ends.
        */}
        <div className="w-full max-w-[26rem] sm:max-w-md sm:rounded-3xl sm:border sm:border-ink-200/80 sm:bg-white sm:p-9 sm:shadow-card lg:max-w-[26rem] lg:rounded-none lg:border-0 lg:p-0 lg:shadow-none">
          <div className="mb-9 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">
              <GraduationCap size={20} />
            </span>
            <span className="text-base font-bold tracking-tight">AI Exam Coach</span>
          </div>

          <h1 className="text-[1.75rem] font-bold tracking-tight text-ink-900 sm:text-3xl">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">{subtitle}</p>

          <div className="mt-8">{children}</div>
          <div className="mt-7 text-center text-sm text-ink-500">{footer}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * A labelled input.
 *
 * Password fields get a reveal toggle. Typing a password blind on a phone
 * keyboard is the most common reason a sign-in fails twice in a row, and the
 * toggle costs nothing to anyone who does not need it.
 */
export function Field({ label, icon: Icon, error, hint, type = 'text', ...rest }) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword && revealed ? 'text' : type;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="label">{label}</label>
        {hint ? <span className="mb-1.5 text-xs text-ink-400">{hint}</span> : null}
      </div>
      <div className="relative">
        {Icon ? (
          <Icon
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
          />
        ) : null}
        <input
          type={inputType}
          className={`input py-3 ${Icon ? 'pl-10' : ''} ${isPassword ? 'pr-11' : ''} ${
            error ? 'border-rose-400 focus:border-rose-400 focus:ring-rose-100' : ''
          }`}
          {...rest}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600"
          >
            {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-1.5 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(form);
      toast.success(`Welcome back, ${user.name.split(' ')[0]}`);
      navigate(location.state?.from?.pathname || '/dashboard', { replace: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Pick up where you left off."
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="font-semibold text-brand-600 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {params.get('expired') ? (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
          Your session expired. Please sign in again.
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4">
        <Field
          label="Email"
          icon={Mail}
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <Field
          label="Password"
          icon={Lock}
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <Button type="submit" loading={loading} className="w-full">
          Sign in <ArrowRight size={16} />
        </Button>
      </form>
    </AuthShell>
  );
}
