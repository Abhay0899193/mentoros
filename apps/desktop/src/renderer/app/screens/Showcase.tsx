import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Play, Save, Trash2, Flame, BookOpen } from 'lucide-react';
import { riseIn, staggerChildren, reduced, spring } from '../../motion/springs';
import { profile, missions } from '../../lib/seed';
import { Button, Card, Chip, Keycap, Panel, Overlay, toast } from '../../ui';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.section variants={reduced(reduce, riseIn)} className="flex flex-col gap-4">
      <h2 className="text-h2 text-ink">{title}</h2>
      {children}
    </motion.section>
  );
}

function Swatch({ name, cssVar, text }: { name: string; cssVar: string; text?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-14 rounded-[10px] hairline"
        style={{ background: `var(${cssVar})`, color: text ? `var(${text})` : undefined }}
      >
        {text && <span className="block p-2 text-small">Aa</span>}
      </div>
      <span className="font-mono text-[11px] text-faint">{cssVar}</span>
      <span className="text-small text-muted -mt-1">{name}</span>
    </div>
  );
}

const typeRamp = [
  { cls: 'text-display', label: 'display 40/600', sample: `Good morning, ${profile.name}.` },
  { cls: 'text-h1', label: 'h1 28/600', sample: 'Knowledge Memory' },
  { cls: 'text-h2', label: 'h2 20/600', sample: 'Interview history' },
  { cls: 'text-h3', label: 'h3 16/600', sample: 'DynamoDB Streams — replay semantics' },
  { cls: 'text-body', label: 'body 15/400', sample: 'A GSI lets you query on non-key attributes without scanning the base table.' },
  { cls: 'text-small', label: 'small 13/400', sample: 'Recalled from 3 memories · updated 2 days ago' },
  { cls: 'text-label uppercase tracking-[0.02em] font-medium', label: 'label 12/500', sample: 'System Design' },
];

export function Showcase() {
  const reduce = useReducedMotion();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [springDemo, setSpringDemo] = useState(0);

  return (
    <motion.div
      variants={reduced(reduce, staggerChildren)}
      initial="hidden"
      animate="visible"
      className="mx-auto flex max-w-4xl flex-col gap-10 px-5 py-8 select-text md:gap-16 md:px-10 md:py-16"
    >
      <motion.header variants={reduced(reduce, riseIn)} className="flex flex-col gap-2">
        <h1 className="text-display text-ink">Nocturne</h1>
        <p className="text-body text-muted">
          The MentorOS design system — every primitive, every state, both themes. This page is the
          contract each screen is verified against.
        </p>
      </motion.header>

      <Section title="Surface ladder & inks">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Swatch name="canvas" cssVar="--canvas" text="--body" />
          <Swatch name="surface-1" cssVar="--surface-1" text="--body" />
          <Swatch name="surface-2" cssVar="--surface-2" text="--body" />
          <Swatch name="surface-3" cssVar="--surface-3" text="--body" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Swatch name="ink" cssVar="--ink" />
          <Swatch name="body" cssVar="--body" />
          <Swatch name="muted" cssVar="--muted" />
          <Swatch name="faint" cssVar="--faint" />
        </div>
        <Card padding="compact" className="aurora-bg h-20 border-0 p-0">
          <div className="flex h-full items-end p-4">
            <span className="text-small font-medium text-white/90">
              Aurora — Orb, active nav, progress fills, one hero per screen. Never chrome.
            </span>
          </div>
        </Card>
      </Section>

      <Section title="Type ramp">
        <Card padding="feature" className="flex flex-col gap-5">
          {typeRamp.map((t) => (
            <div key={t.label} className="flex items-baseline gap-6">
              <span className="w-24 shrink-0 font-mono text-[11px] text-faint">{t.label}</span>
              <span className={`${t.cls} text-ink`}>{t.sample}</span>
            </div>
          ))}
          <div className="flex items-baseline gap-6 border-t border-line pt-4">
            <span className="w-24 shrink-0 font-mono text-[11px] text-faint">mono 13/450</span>
            <span className="font-mono text-mono text-ink tabular">
              SQL 92 · Architecture 84 · Behavioral 95 — {profile.interviews.total} interviews
            </span>
          </div>
        </Card>
      </Section>

      <Section title="Buttons — variants × states">
        <Card padding="feature" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={<Play size={15} strokeWidth={1.5} />}>Start mission</Button>
            <Button variant="secondary" icon={<Save size={15} strokeWidth={1.5} />}>Save memory</Button>
            <Button variant="ghost">Skip today</Button>
            <Button variant="danger" icon={<Trash2 size={15} strokeWidth={1.5} />}>Delete thread</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled>Start mission</Button>
            <Button variant="secondary" disabled>Save memory</Button>
            <Button variant="secondary" loading loadingLabel="Pulling llama3.1:8b…" />
            <Button variant="primary" size="sm">Reveal solution</Button>
            <Button variant="ghost" size="sm">Hint 1</Button>
          </div>
          <p className="text-small text-faint">
            Hover scales 1.02, press 0.98 on <span className="font-mono">spring.snappy</span>; focus
            ring via <span className="font-mono">Tab</span>; loading always carries a status label.
          </p>
        </Card>
      </Section>

      <Section title="Chips — status & data tones">
        <Card padding="feature" className="flex flex-wrap items-center gap-3">
          <Chip>{profile.role}</Chip>
          <Chip tone="iris">Persona · Staff Engineer</Chip>
          <Chip tone="success">SQL {profile.interviews.sql}</Chip>
          <Chip tone="warning">DSA {profile.career.dsa}</Chip>
          <Chip tone="danger">Weak · Graphs</Chip>
          <Chip tone="info" icon={<BookOpen size={12} strokeWidth={1.5} />}>
            DDIA {profile.reading.percent}%
          </Chip>
          <Chip tone="warning" icon={<Flame size={12} strokeWidth={1.5} />}>12-day streak</Chip>
        </Card>
      </Section>

      <Section title="Keycaps & shortcuts">
        <Card padding="feature" className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-small text-body">
            Open the palette with <Keycap>⌘</Keycap>
            <Keycap>K</Keycap> · switch modules <Keycap>⌘</Keycap>
            <Keycap>1</Keycap>–<Keycap>9</Keycap> · hold to talk <Keycap>⌥</Keycap>
            <Keycap>Space</Keycap>
          </div>
          <div className="flex items-center gap-2 text-small text-muted">
            Pressed state: <Keycap pressed>⌘</Keycap>
            <Keycap pressed>K</Keycap>
          </div>
        </Card>
      </Section>

      <Section title="Cards & panels">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card interactive padding="compact">
            <h3 className="text-h3 text-ink">Today’s mission</h3>
            <p className="mt-1 text-small text-muted">{missions[3]}</p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="aurora-bg h-full w-3/5 rounded-full" />
            </div>
            <p className="mt-2 font-mono text-[11px] text-faint tabular">3 of 5 complete</p>
          </Card>
          <Panel
            title="Interview stats"
            accessory={<Chip tone="success">↑ trending</Chip>}
          >
            <dl className="flex flex-col gap-2 font-mono text-mono text-body tabular">
              <div className="flex justify-between"><dt className="text-muted">SQL</dt><dd className="text-ink">{profile.interviews.sql}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Architecture</dt><dd className="text-ink">{profile.interviews.architecture}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Behavioral</dt><dd className="text-ink">{profile.interviews.behavioral}</dd></div>
            </dl>
          </Panel>
        </div>
      </Section>

      <Section title="Motion — springs">
        <Card padding="feature" className="flex items-center gap-6">
          <Button variant="secondary" onClick={() => setSpringDemo((n) => n + 1)}>
            Trigger springs
          </Button>
          <div className="flex flex-1 items-center gap-8">
            {(['snappy', 'smooth', 'gentle'] as const).map((k) => (
              <div key={k} className="flex flex-col items-center gap-2">
                <motion.div
                  key={`${k}-${springDemo}`}
                  initial={{ y: reduce ? 0 : -24, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={reduce ? { duration: 0.12 } : spring[k]}
                  className="size-8 rounded-[10px] bg-surface-3 hairline-strong"
                />
                <span className="font-mono text-[11px] text-faint">{k}</span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      <Section title="Overlay & toasts">
        <Card padding="feature" className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setOverlayOpen(true)}>
            Open glass overlay
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              toast({ tone: 'success', title: 'Memory saved', description: 'Weakness: Graphs, DP → linked to goal “Staff Engineer”.' })
            }
          >
            Success toast
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              toast({
                tone: 'danger',
                title: 'Ollama is offline',
                description: 'The local model isn’t responding.',
                action: { label: 'Retry connection', onClick: () => toast({ tone: 'info', title: 'Retrying…' }) },
              })
            }
          >
            Error toast (with action)
          </Button>
        </Card>
        <Overlay open={overlayOpen} onClose={() => setOverlayOpen(false)} align="center" width={420}>
          <div className="flex flex-col gap-3 p-6">
            <h3 className="text-h3 text-ink">Save this as a memory?</h3>
            <p className="text-small text-muted">
              “Prefers hints before solutions when practicing DP problems.”
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setOverlayOpen(false)}>Not now</Button>
              <Button variant="primary" onClick={() => setOverlayOpen(false)}>Save memory</Button>
            </div>
          </div>
        </Overlay>
      </Section>
    </motion.div>
  );
}
