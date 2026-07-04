import { motion, useReducedMotion } from 'motion/react';
import { riseIn, staggerChildren, reduced } from '../../motion/springs';
import type { ModuleMeta } from '../../lib/store';
import { Chip } from '../../ui';

const phaseByModule: Record<string, string> = {
  home: 'Phase 3 · Daily Loop',
  chat: 'Phase 1b · next up',
  voice: 'Phase 1c · the magic moment',
  memory: 'Phase 2 · Knowledge Memory',
  interview: 'Phase 5 · Interview Platform',
  learning: 'Phase 3 · Daily Loop',
  knowledge: 'Phase 4 · Knowledge Base',
  codebase: 'Phase 6 · Codebase Mentor',
  career: 'Phase 6 · Career Dashboard',
};

/** Designed pre-build state — an empty module is never a blank box (§0.2.5). */
export function Placeholder({ meta }: { meta: ModuleMeta }) {
  const reduce = useReducedMotion();
  const Icon = meta.icon;

  return (
    <motion.div
      variants={reduced(reduce, staggerChildren)}
      initial="hidden"
      animate="visible"
      className="flex h-full flex-col items-center justify-center gap-4 p-8"
    >
      <motion.div
        variants={reduced(reduce, riseIn)}
        className="flex size-16 items-center justify-center rounded-[14px] bg-surface-2 hairline"
      >
        <Icon size={28} strokeWidth={1.5} className="text-muted" />
      </motion.div>
      <motion.h1 variants={reduced(reduce, riseIn)} className="text-h2 text-ink">
        {meta.label}
      </motion.h1>
      <motion.div variants={reduced(reduce, riseIn)}>
        <Chip>{phaseByModule[meta.id] ?? 'Coming soon'}</Chip>
      </motion.div>
      <motion.p
        variants={reduced(reduce, riseIn)}
        className="max-w-sm text-center text-small text-muted"
      >
        This module arrives later in the build. The design foundation it will stand on is what
        you’re looking at now.
      </motion.p>
    </motion.div>
  );
}
