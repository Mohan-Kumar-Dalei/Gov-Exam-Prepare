import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { User, Mail, Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Button } from '../components/ui/index.jsx';
import { AuthShell, Field } from './Login.jsx';

/** Mirrors the server's zod rules so the user sees failures before submitting. */
function validate({ name, email, password }) {
  const errors = {};
  if (name.trim().length < 2) errors.name = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (password.length < 8) errors.password = 'At least 8 characters.';
  else if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    errors.password = 'Must include a letter and a number.';
  }
  return errors;
}

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [touched, setTouched] = useState({});
  const [loading, setLoading] = useState(false);

  const errors = useMemo(() => validate(form), [form]);
  const visible = (field) => (touched[field] ? errors[field] : undefined);

  const onSubmit = async (e) => {
    e.preventDefault();
    setTouched({ name: true, email: true, password: true });
    if (Object.keys(errors).length) return;

    setLoading(true);
    try {
      const user = await signup(form);
      toast.success(`Account created. Welcome, ${user.name.split(' ')[0]}`);
      navigate('/upload', { replace: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free to start. Upload a notification PDF next."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-brand-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label="Full name"
          icon={User}
          required
          placeholder="Ananya Sharma"
          value={form.name}
          error={visible('name')}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Field
          label="Email"
          icon={Mail}
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={form.email}
          error={visible('email')}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <Field
          label="Password"
          icon={Lock}
          type="password"
          autoComplete="new-password"
          required
          placeholder="At least 8 characters"
          value={form.password}
          error={visible('password')}
          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <Button type="submit" loading={loading} className="w-full">
          Create account <ArrowRight size={16} />
        </Button>
      </form>
    </AuthShell>
  );
}
