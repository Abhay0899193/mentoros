import { motion, useReducedMotion } from 'motion/react';
import { Flame } from 'lucide-react';
import { spring } from '../../../motion/springs';
import type { LearningSummary } from '../../../lib/coreClient';

const SIZE = 52;
const STROKE = 4;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

/**
 * Header identity block (plan §E): level ring with XP-into-level fill,
 * "620 / 900 XP" line and the streak flame. Color only on data (§3.0.2):
 * the ring fill is iris, chrome stays monochrome.
 */
export function LevelRing({ summary }: { summary: LearningSummary }) {
  const reduce = useReducedMotion();
  const total = summary.xpIntoLevel + summary.xpToNext;
  const frac = summary.xpToNext === 0 ? 1 : total > 0 ? summary.xpIntoLevel / total : 0;

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-[var(--surface-2)]"
          />
          <motion.circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            initial={reduce ? false : { strokeDashoffset: CIRC }}
            animate={{ strokeDashoffset: CIRC * (1 - frac) }}
            transition={reduce ? { duration: 0 } : spring.smooth}
            className="stroke-[var(--iris)]"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[13px] font-semibold text-ink tabular">
          {summary.level}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-[11px] tracking-[0.06em] text-faint uppercase">Level {summary.level}</span>
        <span className="font-mono text-small text-muted tabular">
          {summary.xpToNext > 0
            ? `${summary.xpIntoLevel.toLocaleString()} / ${total.toLocaleString()} XP`
            : `${summary.xp.toLocaleString()} XP · max`}
        </span>
      </div>
      {summary.streak.current > 0 && (
        <div
          className="flex items-center gap-1 rounded-full bg-surface-1 hairline px-2.5 py-1"
          title={`Streak: ${summary.streak.current} day${summary.streak.current === 1 ? '' : 's'} · best ${summary.streak.best}`}
        >
          <Flame size={13} strokeWidth={1.5} className="text-warning" />
          <span className="font-mono text-[12px] text-ink tabular">{summary.streak.current}</span>
        </div>
      )}
    </div>
  );
}
