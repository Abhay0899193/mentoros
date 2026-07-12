import { useSyncExternalStore } from 'react';

/**
 * Layout breakpoints — the same values Tailwind's `md:` / `lg:` compile to, so
 * a component can branch in JS and in classes without the two drifting apart.
 *
 * Prefer a Tailwind class (`md:flex`) when the change is purely visual. Reach
 * for these hooks only when the DOM itself has to differ — e.g. the phone
 * renders a bottom tab bar and no Rail at all, which no class can express.
 */
export const BREAKPOINT = {
  /** Phone. Below this the shell drops the Rail for a bottom tab bar. */
  md: 768,
  /** Below this the right ContextPanel becomes a drawer instead of a column. */
  lg: 1024,
} as const;

function subscribe(query: string) {
  return (onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  };
}

/** Live `matchMedia`, re-rendering on change. SSR-safe (returns false). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone-sized viewport (< 768px): bottom tabs, sheets, single column. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${BREAKPOINT.md - 1}px)`);
}

/** Phone or narrow tablet (< 1024px): no room for the right context column. */
export function useIsCompact(): boolean {
  return useMediaQuery(`(max-width: ${BREAKPOINT.lg - 1}px)`);
}

/** Finger, not mouse — hover affordances don't exist here. */
export function useIsTouch(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
