import { useState } from 'react';
import toast from 'react-hot-toast';
import {
  KeyRound,
  Plus,
  Trash2,
  Power,
  RefreshCw,
  Zap,
  ArrowUp,
  ArrowDown,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { keyApi } from '../api/endpoints.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Card,
  CardHeader,
  Button,
  Badge,
  PageHeader,
  EmptyState,
  ErrorState,
  Skeleton,
} from '../components/ui/index.jsx';

const STATUS = {
  ok: { tone: 'green', label: 'Working' },
  untested: { tone: 'slate', label: 'Not tested' },
  rate_limited: { tone: 'amber', label: 'Rate limited' },
  exhausted: { tone: 'red', label: 'Out of credits' },
  invalid: { tone: 'red', label: 'Invalid' },
};

export default function Settings() {
  const { user } = useAuth();
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const ring = useAsync(() => keyApi.list(), []);

  const isAdmin = user?.role === 'admin';

  const act = async (id, fn, successMessage) => {
    setBusyId(id);
    try {
      const res = await fn();
      toast.success(res?.message || successMessage);
      await ring.run();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const add = async (e) => {
    e.preventDefault();
    if (key.trim().length < 20) return toast.error('That does not look like a Gemini API key.');

    setAdding(true);
    try {
      await keyApi.add({ label: label.trim(), key: key.trim() });
      toast.success('Key added to the ring.');
      setLabel('');
      setKey('');
      await ring.run();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
    return undefined;
  };

  const move = async (item, direction) => {
    const list = ring.data?.data?.keys || [];
    const index = list.findIndex((k) => k.id === item.id);
    const swapWith = list[index + direction];
    if (!swapWith) return;

    setBusyId(item.id);
    try {
      await Promise.all([
        keyApi.update(item.id, { priority: swapWith.priority }),
        keyApi.update(swapWith.id, { priority: item.priority }),
      ]);
      await ring.run();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Settings" />
        <EmptyState
          icon={ShieldCheck}
          title="Admins only"
          description="API keys control billing for the whole deployment, so only the owner account can manage them."
        />
      </>
    );
  }

  if (ring.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (ring.error) return <ErrorState error={ring.error} onRetry={ring.run} />;

  const { keys = [], envKeyPresent, envKey, usableCount } = ring.data?.data || {};

  return (
    <>
      <PageHeader
        title="API keys"
        subtitle="Keys are tried in order. One that runs out of credits or hits a rate limit is skipped automatically."
      />

      <div
        className={`mb-6 flex items-start gap-3 rounded-2xl border p-4 ${
          usableCount > 0 ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
        }`}
      >
        {usableCount > 0 ? (
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-600" />
        ) : (
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600" />
        )}
        <div className="text-sm">
          <p className={`font-semibold ${usableCount > 0 ? 'text-emerald-900' : 'text-rose-900'}`}>
            {usableCount > 0
              ? `${usableCount} key${usableCount === 1 ? '' : 's'} ready to serve requests`
              : 'No usable key — AI features will fail'}
          </p>
          {envKeyPresent ? (
            <div className="mt-1 text-ink-600">
              <p>
                A key from <code className="rounded bg-white/70 px-1">GEMINI_API_KEY</code> is also
                in the ring, tried last.
                {envKey?.available ? null : (
                  <span className="font-medium text-rose-700">
                    {' '}
                    It is currently skipped ({STATUS[envKey?.status]?.label || envKey?.status}).
                  </span>
                )}
              </p>
              {envKey && !envKey.available ? (
                <Button
                  variant="secondary"
                  className="mt-2"
                  icon={RefreshCw}
                  onClick={() => act('env', () => keyApi.reviveEnv(), 'Will be tried again.')}
                >
                  Try it again now
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader title="Add a key" icon={Plus} />
        <form onSubmit={add} className="card-pad space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <div>
              <label className="label">Label</label>
              <input
                className="input"
                placeholder="Personal account"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
              />
            </div>
            <div>
              <label className="label">Gemini API key</label>
              <input
                className="input font-mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste the key from aistudio.google.com"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={adding} icon={Plus}>
              Add to ring
            </Button>
            <p className="text-xs text-ink-500">
              Stored encrypted. It is never shown again or sent back to this page.
            </p>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="The ring"
          subtitle={`${keys.length} key${keys.length === 1 ? '' : 's'}, tried top to bottom`}
          icon={KeyRound}
          action={
            <Button variant="ghost" icon={RefreshCw} onClick={ring.run}>
              Refresh
            </Button>
          }
        />

        {keys.length ? (
          <div className="divide-y divide-ink-100">
            {keys.map((k, i) => {
              const status = STATUS[k.status] || STATUS.untested;
              const busy = busyId === k.id;

              return (
                <div key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-100 text-xs font-bold text-ink-600">
                    {i + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink-900">{k.label}</p>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {!k.enabled ? <Badge tone="slate">Disabled</Badge> : null}
                      {k.available ? null : <Badge tone="amber">Skipped</Badge>}
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-ink-400">{k.masked}</p>
                    {k.lastError ? (
                      <p className="mt-1 text-xs text-rose-600">{k.lastError}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-ink-400">
                      {k.successCount} ok · {k.failureCount} failed
                      {k.lastUsedAt
                        ? ` · last used ${new Date(k.lastUsedAt).toLocaleString('en-IN')}`
                        : ''}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    <button
                      onClick={() => move(k, -1)}
                      disabled={i === 0 || busy}
                      title="Try this key earlier"
                      className="rounded-lg p-2 text-ink-400 hover:bg-ink-100 disabled:opacity-30"
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      onClick={() => move(k, 1)}
                      disabled={i === keys.length - 1 || busy}
                      title="Try this key later"
                      className="rounded-lg p-2 text-ink-400 hover:bg-ink-100 disabled:opacity-30"
                    >
                      <ArrowDown size={15} />
                    </button>

                    <Button
                      variant="ghost"
                      icon={Zap}
                      loading={busy}
                      onClick={() => act(k.id, () => keyApi.test(k.id), 'Tested.')}
                    >
                      Test
                    </Button>

                    {k.status === 'exhausted' || k.status === 'rate_limited' || !k.enabled ? (
                      <Button
                        variant="ghost"
                        icon={RefreshCw}
                        loading={busy}
                        onClick={() => act(k.id, () => keyApi.revive(k.id), 'Re-enabled.')}
                      >
                        Revive
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        icon={Power}
                        loading={busy}
                        onClick={() =>
                          act(k.id, () => keyApi.update(k.id, { enabled: false }), 'Disabled.')
                        }
                      >
                        Disable
                      </Button>
                    )}

                    <button
                      onClick={() => act(k.id, () => keyApi.remove(k.id), 'Removed.')}
                      disabled={busy}
                      title="Remove"
                      className="rounded-lg p-2 text-ink-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={KeyRound}
              title="No keys in the ring"
              description={
                envKeyPresent
                  ? 'Your .env key is being used. Add more here so requests can move on when one runs out.'
                  : 'Add a Gemini API key above to switch on the AI features.'
              }
            />
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <div className="card-pad text-sm text-ink-600">
          <p className="font-semibold text-ink-900">How rotation works</p>
          <ul className="mt-2 space-y-1.5">
            <li>
              · <strong>Out of credits (402)</strong> or an <strong>invalid key</strong> — parked
              immediately, and the next key takes over. Press Revive after topping up.
            </li>
            <li>
              · <strong>Rate limited (429)</strong> — set aside for five minutes, then tried again.
            </li>
            <li>
              · <strong>Model overloaded (503)</strong> — this is the model being busy, not your key,
              so the model fallback chain runs first. Only if every model fails does the next key get
              a turn.
            </li>
          </ul>
        </div>
      </Card>
    </>
  );
}
