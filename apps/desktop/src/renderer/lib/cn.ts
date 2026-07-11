import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/* Nocturne defines custom font-size tokens (--text-small, --text-label, …).
   tailwind-merge can't tell `text-small` (size) from `text-canvas` (color)
   without this list, so it dropped the color class whenever a size class
   followed — e.g. primary Buttons lost `text-canvas` and rendered inherited
   light-gray text on the white ink pill. Keep this list in sync with the
   --text-* names in theme/tokens.css. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display', 'h1', 'h2', 'h3', 'body', 'small', 'label', 'mono'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
