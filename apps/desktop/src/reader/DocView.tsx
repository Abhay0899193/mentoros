/**
 * Reading screen. Full-bleed typography, a scroll-progress hairline, and the
 * part navigation the week guides are written for. Position is remembered per
 * doc so "Continue reading" lands where you stopped.
 */
import { useEffect, useRef } from 'react';
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../renderer/lib/cn';
import { spring } from '../renderer/motion/springs';
import { ReadingMarkdown } from '../renderer/app/screens/knowledge/ReadingMarkdown';
import {
  docKind,
  pushRecent,
  saveScrollRatio,
  scrollRatios,
  siblings,
  type ReaderBundle,
  type ReaderDoc,
} from './bundle';
import { navigate } from './App';

/**
 * The screen already shows the title as its own h1, and every guide opens with
 * the same heading — drop the duplicate rather than print it twice.
 */
function stripLeadingH1(markdown: string): string {
  return markdown.replace(/^#\s+.*(\r?\n)+/, '');
}

/** Resolve `../week-01/02-x.md` against the current doc id (both are 3mc-relative). */
function resolveRelative(fromId: string, rel: string): string {
  const base = fromId.split('/').slice(0, -1);
  const parts = rel.replace(/\.md$/, '').split('/');
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}

export function DocView({ bundle, doc }: { bundle: ReaderBundle; doc: ReaderDoc }) {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const restored = useRef(false);

  const parts = siblings(bundle, doc);
  const index = parts.findIndex((d) => d.id === doc.id);
  const prev = index > 0 ? parts[index - 1] : undefined;
  const next = index >= 0 && index < parts.length - 1 ? parts[index + 1] : undefined;

  useEffect(() => {
    pushRecent(doc.id);
  }, [doc.id]);

  // Restore after the document has laid out. One frame is enough for the
  // markdown; mermaid blocks stream in later and will nudge the offset — better
  // than blocking the first paint on them.
  useEffect(() => {
    restored.current = false;
    const ratio = scrollRatios()[doc.id] ?? 0;
    const id = requestAnimationFrame(() => {
      if (ratio > 0.02 && ratio < 0.98) {
        window.scrollTo({ top: ratio * (document.body.scrollHeight - window.innerHeight) });
      }
      restored.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [doc.id]);

  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    if (restored.current) saveScrollRatio(doc.id, value);
  });

  return (
    <>
      {/* Nearly opaque, not glass: body text scrolling under a 4%-white pane
          stays legible through it and the page reads as smeared. */}
      <header className="bg-canvas/95 sticky top-0 z-20 pt-safe backdrop-blur-xl">
        <div className="flex items-center gap-2 px-2 py-2">
          <button
            onClick={() => window.history.back()}
            aria-label="Back"
            className="tap-target text-muted active:text-ink flex size-11 items-center justify-center rounded-[10px]"
          >
            <ChevronLeft size={22} strokeWidth={1.8} />
          </button>
          <span className="text-small text-muted line-clamp-1 min-w-0 flex-1">{doc.title}</span>
          <span className="text-small text-faint shrink-0 pr-3">{doc.minutes} min</span>
        </div>
        <motion.span
          style={{ scaleX: scrollYProgress }}
          className="aurora-bg block h-[2px] origin-left"
        />
      </header>

      <article className="mx-auto max-w-[68ch] px-5 pt-4 pb-10">
        <h1 className="text-ink text-[28px] leading-[1.15] font-semibold tracking-[-0.02em]">
          {doc.title}
        </h1>
        <p className="text-small text-faint mt-2 mb-6">
          {docKind(doc) === 'sheet'
            ? 'Quick review'
            : docKind(doc) === 'day'
              ? 'Day notes'
              : 'Study guide'}
          {doc.readAt && ` · read ${new Date(doc.readAt).toLocaleDateString()}`}
        </p>
        <div className="reader-prose">
          <ReadingMarkdown
            text={stripLeadingH1(doc.markdown)}
            onOpenRelative={(rel) => {
              const id = resolveRelative(doc.id, rel);
              if (bundle.docs.some((d) => d.id === id)) navigate({ view: 'doc', id });
            }}
          />
        </div>
      </article>

      {(prev || next) && (
        <nav className="flex gap-2.5 px-5 pb-safe-plus-8">
          {[prev, next].map((sibling, i) =>
            sibling ? (
              <motion.button
                key={sibling.id}
                onClick={() => navigate({ view: 'doc', id: sibling.id })}
                whileTap={reduce ? undefined : { scale: 0.985 }}
                transition={spring.snappy}
                className={cn(
                  'hairline bg-surface-1 flex flex-1 items-center gap-2 rounded-[14px] p-4 text-left',
                  i === 1 && 'text-right',
                )}
              >
                {i === 0 && <ChevronLeft size={16} strokeWidth={1.8} className="text-faint shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="text-label text-faint block tracking-[0.08em] uppercase">
                    {i === 0 ? 'Previous' : 'Next'}
                  </span>
                  <span className="text-ink mt-0.5 line-clamp-2 block text-[14px] leading-snug font-medium">
                    {sibling.title}
                  </span>
                </span>
                {i === 1 && <ChevronRight size={16} strokeWidth={1.8} className="text-faint shrink-0" />}
              </motion.button>
            ) : (
              <span key={i} className="flex-1" />
            ),
          )}
        </nav>
      )}
    </>
  );
}
