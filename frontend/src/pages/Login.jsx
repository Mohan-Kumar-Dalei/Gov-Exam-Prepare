import { useState } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { GraduationCap, Mail, Lock, ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Button } from '../components/ui/index.jsx';

export function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Marketing panel — hidden on small screens so the form stays the focus. */}
      <div className="relative hidden overflow-hidden bg-ink-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-violet-600/20 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-600">
            <GraduationCap size={22} />
          </span>
          <span className="text-lg font-bold">AI Exam Coach</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight">
            Upload one notification PDF. Get an entire preparation system.
          </h2>
          <ul className="mt-8 space-y-4 text-sm text-ink-300">
            {[
              'Syllabus, pattern, vacancies and dates extracted automatically',
              'Lessons, notes, tricks and worked examples for every topic',
              'Adaptive quizzes that chase your weak topics',
              'Full CBT mock tests built from the real exam pattern',
              'A 60-day roadmap and an AI mentor that knows your scores',
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <Sparkles size={16} className="mt-0.5 shrink-0 text-brand-400" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-ink-500">Built for Indian competitive exam aspirants.</p>
      </div>

      <div className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">
              <GraduationCap size={20} />
            </span>
            <span className="text-base font-bold">AI Exam Coach</span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
          <p className="mt-1.5 text-sm text-ink-500">{subtitle}</p>

          <div className="mt-8">{children}</div>
          <div className="mt-6 text-center text-sm text-ink-500">{footer}</div>
        </div>
      </div>
    </div>
  );
}

export function Field({ label, icon: Icon, error, ...rest }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        {Icon ? (
          <Icon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        ) : null}
        <input className={`input ${Icon ? 'pl-9' : ''} ${error ? 'border-rose-400' : ''}`} {...rest} />
      </div>
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
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
