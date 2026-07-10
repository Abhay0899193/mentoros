import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cn } from '../lib/cn';
import type { FaceRegion } from '../lib/coreClient';

/**
 * RegionBox — draggable/resizable rectangle for marking a face region
 * (mouth/eyes) over an image, in the image's natural pixel coordinates.
 * Shared by the Settings preset-from-photos overlay and the studio's
 * create-from-frames Align step.
 */

export function clampRegion(r: FaceRegion, w: number, h: number): FaceRegion {
  const width = Math.min(Math.max(40, r.width), w);
  const height = Math.min(Math.max(30, r.height), h);
  return {
    width,
    height,
    x: Math.min(Math.max(0, r.x), w - width),
    y: Math.min(Math.max(0, r.y), h - height),
  };
}

export function RegionBox({
  label,
  region,
  scale,
  selected,
  onSelect,
  onChange,
  imgW,
  imgH,
}: {
  label: string;
  region: FaceRegion;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (r: FaceRegion) => void;
  imgW: number;
  imgH: number;
}) {
  // Pointer drags mutate a ref and commit through onChange each move so the
  // box tracks the cursor exactly (no spring — this is a measuring tool).
  const drag = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; start: FaceRegion } | null>(null);

  const onPointerDown = (mode: 'move' | 'resize') => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, startX: e.clientX, startY: e.clientY, start: region };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    onChange(
      clampRegion(
        d.mode === 'move'
          ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy }
          : { ...d.start, width: d.start.width + dx, height: d.start.height + dy },
        imgW,
        imgH,
      ),
    );
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = 8;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    onChange(
      clampRegion(
        e.shiftKey
          ? { ...region, width: region.width + d[0], height: region.height + d[1] }
          : { ...region, x: region.x + d[0], y: region.y + d[1] },
        imgW,
        imgH,
      ),
    );
  };

  return (
    <div
      role="slider"
      aria-label={`${label} region — arrows move, shift+arrows resize`}
      aria-valuetext={`${Math.round(region.x)},${Math.round(region.y)} ${Math.round(region.width)}×${Math.round(region.height)}`}
      tabIndex={0}
      onPointerDown={onPointerDown('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        'absolute cursor-move rounded-[4px] border focus:outline-none',
        selected
          ? 'border-[var(--iris)] shadow-[0_0_0_1px_var(--iris)]'
          : 'border-white/70 hover:border-white',
      )}
      style={{
        left: region.x * scale,
        top: region.y * scale,
        width: region.width * scale,
        height: region.height * scale,
      }}
    >
      <span className="absolute -top-5 left-0 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
        {label}
      </span>
      <div
        onPointerDown={onPointerDown('resize')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          'absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white/80',
          selected ? 'bg-[var(--iris)]' : 'bg-black/60',
        )}
      />
    </div>
  );
}
