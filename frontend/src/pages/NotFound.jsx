import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-6">
      <div className="text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-900 text-white mx-auto">
          <Compass size={26} />
        </span>
        <h1 className="mt-5 text-3xl font-bold text-ink-900">Page not found</h1>
        <p className="mt-2 text-sm text-ink-500">
          That route does not exist in AI Exam Coach.
        </p>
        <Link to="/dashboard" className="btn-primary mt-6">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
