import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * The single renderer for every AI-generated text surface.
 *
 * Model output is markdown by contract, so displaying it raw leaks `**` and `##`
 * onto the screen. Every component that shows prose from the model — mentor
 * chat, lesson explanations, feedback summaries — renders through here so the
 * typography stays consistent and nothing has to reinvent the styling.
 *
 * @param {'chat'|'lesson'} [tone] chat is compact and inherits its bubble's
 *   colour; lesson is the roomier reading layout.
 */
export default function Markdown({ children, tone = 'chat', className = '' }) {
  const lesson = tone === 'lesson';

  const components = {
    h1: ({ children: c }) => (
      <h2 className={`${lesson ? 'mt-7 text-xl' : 'mt-4 text-base'} mb-2 font-bold tracking-tight first:mt-0`}>
        {c}
      </h2>
    ),
    h2: ({ children: c }) => (
      <h3
        className={`${
          lesson ? 'mt-7 text-lg' : 'mt-4 text-[15px]'
        } mb-2 font-bold tracking-tight first:mt-0`}
      >
        {c}
      </h3>
    ),
    h3: ({ children: c }) => (
      <h4 className={`${lesson ? 'mt-5' : 'mt-3'} mb-1.5 text-sm font-semibold first:mt-0`}>{c}</h4>
    ),

    p: ({ children: c }) => (
      <p className={`${lesson ? 'mb-4 leading-7' : 'mb-2.5 leading-relaxed'} last:mb-0`}>{c}</p>
    ),

    // Custom markers rather than list-disc: a coloured dot reads better against
    // both the grey chat bubble and the white lesson card.
    ul: ({ children: c }) => <ul className={`${lesson ? 'mb-4' : 'mb-2.5'} space-y-1.5 last:mb-0`}>{c}</ul>,
    ol: ({ children: c }) => (
      <ol className={`${lesson ? 'mb-4' : 'mb-2.5'} list-decimal space-y-1.5 pl-5 last:mb-0 marker:font-semibold marker:text-brand-600`}>
        {c}
      </ol>
    ),
    li: ({ children: c, ...rest }) => {
      const ordered = rest.node?.parent?.type === 'list' && rest.node.parent.ordered;
      if (ordered) return <li className="pl-1 leading-relaxed">{c}</li>;
      return (
        <li className="relative pl-5 leading-relaxed">
          <span className="absolute left-1 top-[0.6em] h-1.5 w-1.5 rounded-full bg-brand-500" />
          {c}
        </li>
      );
    },

    strong: ({ children: c }) => <strong className="font-semibold text-ink-900">{c}</strong>,
    em: ({ children: c }) => <em className="italic">{c}</em>,

    code: ({ inline, children: c }) =>
      inline ? (
        <code className="rounded-md bg-ink-900/[0.06] px-1.5 py-0.5 font-mono text-[0.85em] text-brand-700">
          {c}
        </code>
      ) : (
        <code className="block overflow-x-auto rounded-xl bg-ink-900 p-3.5 font-mono text-[0.85em] text-emerald-300">
          {c}
        </code>
      ),
    pre: ({ children: c }) => <pre className={`${lesson ? 'mb-4' : 'mb-2.5'} last:mb-0`}>{c}</pre>,

    blockquote: ({ children: c }) => (
      <blockquote className="my-3 border-l-[3px] border-brand-400 bg-brand-50/60 py-1 pl-4 italic">
        {c}
      </blockquote>
    ),

    a: ({ children: c, href }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-brand-600 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-600"
      >
        {c}
      </a>
    ),

    hr: () => <hr className="my-5 border-ink-200" />,

    table: ({ children: c }) => (
      <div className="my-4 overflow-x-auto rounded-xl border border-ink-200">
        <table className="w-full text-left text-sm">{c}</table>
      </div>
    ),
    thead: ({ children: c }) => <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">{c}</thead>,
    th: ({ children: c }) => <th className="px-3 py-2 font-semibold">{c}</th>,
    td: ({ children: c }) => <td className="border-t border-ink-100 px-3 py-2">{c}</td>,
  };

  return (
    <div className={`${lesson ? 'text-[15px] text-ink-700' : 'text-sm'} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}
