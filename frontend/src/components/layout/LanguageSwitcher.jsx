import { useState } from 'react';
import toast from 'react-hot-toast';
import { Languages, Check } from 'lucide-react';
import { authApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';

export const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hinglish', label: 'Hinglish', native: 'Hinglish' },
  { code: 'od', label: 'Odia', native: 'ଓଡ଼ିଆ' },
];

/**
 * Sets the language for AI-generated content: questions, options, explanations,
 * lessons and the mentor. Changing it does not translate existing content —
 * new content is generated in the chosen language from here on.
 */
export default function LanguageSwitcher({ compact = false }) {
  const { user, updateUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = user?.preferences?.language || 'en';
  const active = LANGUAGE_OPTIONS.find((l) => l.code === current) || LANGUAGE_OPTIONS[0];

  const choose = async (code) => {
    if (code === current) return setOpen(false);

    setSaving(true);
    try {
      await authApi.updateProfile({ preferences: { language: code } });
      updateUser({ preferences: { ...user.preferences, language: code } });
      const chosen = LANGUAGE_OPTIONS.find((l) => l.code === code);
      toast.success(`New questions and lessons will be in ${chosen.native}.`);
      setOpen(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        className={`flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50 ${
          compact ? '' : 'w-full'
        }`}
      >
        <Languages size={16} className="shrink-0 text-ink-400" />
        <span className="flex-1 text-left">{active.native}</span>
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-20 mb-2 w-full min-w-[180px] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lg">
            <p className="border-b border-ink-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              Content language
            </p>
            {LANGUAGE_OPTIONS.map((l) => (
              <button
                key={l.code}
                onClick={() => choose(l.code)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-ink-700 transition-colors hover:bg-ink-50"
              >
                <span>
                  {l.native}
                  {l.native !== l.label ? (
                    <span className="ml-1.5 text-xs text-ink-400">{l.label}</span>
                  ) : null}
                </span>
                {l.code === current ? <Check size={15} className="text-brand-600" /> : null}
              </button>
            ))}
            <p className="border-t border-ink-100 px-3 py-2 text-[11px] leading-relaxed text-ink-400">
              Applies to new questions, lessons and mentor replies. Exam terms stay in English.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
