/**
 * Nocturne motion system (plan.md §3.4).
 * Spring physics only — linear/instant transitions are banned for
 * entrances, layout shifts, and state changes. Everything must
 * degrade under prefers-reduced-motion (see reduced() helper).
 */
import type { Transition, Variants } from 'motion/react';

export const spring = {
  /** buttons, toggles, hover */
  snappy: { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 },
  /** panels, layout shifts */
  smooth: { type: 'spring', stiffness: 240, damping: 30 },
  /** entrances, large moves */
  gentle: { type: 'spring', stiffness: 130, damping: 22 },
} as const satisfies Record<string, Transition>;

export const easePremium = [0.2, 0.8, 0.2, 1] as const;

export const dur = { micro: 0.12, base: 0.2, enter: 0.32 } as const;

/** Entrance: fade + 8px rise on spring.gentle (§3.4 “Entrances”). */
export const riseIn: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: spring.gentle },
};

/** Container that staggers riseIn children 35ms apart. */
export const staggerChildren: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.035 } },
};

/** Micro press/hover scales for interactive elements. */
export const press = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
  transition: spring.snappy,
} as const;

/** Reduced-motion fallback: springs → 120ms opacity fade. */
export const fadeOnly: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: dur.micro } },
};

/**
 * Pick spring variants normally, plain fades under reduced motion.
 * Usage: const v = reduced(prefersReducedMotion, riseIn)
 */
export function reduced(prefersReduced: boolean | null, variants: Variants): Variants {
  return prefersReduced ? fadeOnly : variants;
}
