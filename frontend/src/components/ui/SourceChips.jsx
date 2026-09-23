import { useState } from 'react';
import { Globe, ExternalLink } from 'lucide-react';

/**
 * The pages a grounded answer actually consulted.
 *
 * These are not decoration. When the app says a question or a past paper was
 * checked against the web, the learner's reasonable next question is "checked
 * against what?" — and a list they can open and read is the only answer that
 * means anything. It is also the difference between a claim and a receipt: a
 * fabricated fact has no sources behind it, and an empty list is itself
 * informative.
 *
 * Favicons are fetched from Google's icon service, which means the browser
 * tells Google which domains are being shown. That is a real, if small, cost;
 * it is accepted here because these pages came from a Google search in the
 * first place. Anything that fails to load falls back to a letter, so a
 * blocked or missing icon never leaves a broken image behind.
 */

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return String(url).replace(/^https?:\/\//, '').split('/')[0];
  }
};

const faviconFor = (url) =>
  `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostOf(url))}`;

function SourceIcon({ url, size = 20, className = '' }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(url);

  if (failed || !host) {
    return (
      <span
        style={{ width: size, height: size }}
        className={`grid shrink-0 place-items-center rounded-full bg-brand-100 text-[9px] font-bold uppercase text-brand-700 ${className}`}
      >
        {host ? host[0] : '?'}
      </span>
    );
  }

  return (
    <img
      src={faviconFor(url)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      // A site with no favicon gets a blank or transparent placeholder from the
      // icon service rather than an error, so onError never fires for it. The
      // tinted disc underneath means that still reads as an icon rather than a
      // hole punched in the row.
      className={`shrink-0 rounded-full border border-ink-200 bg-ink-50 object-contain p-px ${className}`}
    />
  );
}

export default function SourceChips({ sources = [], label = 'Searched', className = '' }) {
  const [open, setOpen] = useState(false);

  const unique = [...new Map(sources.filter(Boolean).map((s) => [hostOf(s), s])).values()];
  if (!unique.length) return null;

  const stack = unique.slice(0, 4);
  const extra = unique.length - stack.length;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white py-1 pl-1.5 pr-3 transition-colors hover:border-brand-300 hover:bg-brand-50/50"
      >
        <span className="flex items-center -space-x-1.5">
          {stack.map((src) => (
            <SourceIcon key={src} url={src} className="ring-2 ring-white" />
          ))}
          {extra ? (
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink-200 text-[9px] font-bold text-ink-600 ring-2 ring-white">
              +{extra}
            </span>
          ) : null}
        </span>
        <span className="text-xs font-semibold text-ink-600 group-hover:text-brand-700">
          {label} {unique.length} {unique.length === 1 ? 'source' : 'sources'}
        </span>
      </button>

      {open ? (
        <ul className="mt-2 space-y-1">
          {unique.map((src) => (
            <li key={src}>
              <a
                href={src}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink-600 transition-colors hover:bg-ink-50 hover:text-brand-700"
              >
                <SourceIcon url={src} size={16} />
                <span className="min-w-0 flex-1 truncate">{hostOf(src)}</span>
                <ExternalLink size={12} className="shrink-0 text-ink-400" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Shown where a grounded answer has no sources to name. */
export function NoSourcesNote({ children, className = '' }) {
  return (
    <p className={`inline-flex items-center gap-1.5 text-xs text-ink-500 ${className}`}>
      <Globe size={12} className="shrink-0" />
      {children}
    </p>
  );
}
