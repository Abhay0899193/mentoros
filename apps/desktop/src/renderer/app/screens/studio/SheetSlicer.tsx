import { useCallback, useEffect, useRef, useState } from 'react';
import { Grid3X3, Minus, Plus, RefreshCw } from 'lucide-react';
import { Button } from '../../../ui';
import { cn } from '../../../lib/cn';
import {
  decodeImageFile,
  detectGrid,
  revokeDecoded,
  sliceGrid,
  type DecodedImage,
} from '../../../lib/imageTiles';

/**
 * SheetSlicer — drop a sprite sheet, get frames. Grid detection (gutter scan)
 * is only ever a SUGGESTION: rows×cols steppers are always live, the overlay
 * redraws instantly, and tiles are toggled off by clicking them. Row-major
 * order among the kept tiles becomes the frame order.
 */

interface Stepper {
  label: string;
  value: number;
  onChange: (v: number) => void;
}

function GridStepper({ label, value, onChange }: Stepper) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-small text-muted">{label}</span>
      <div className="inline-flex items-center rounded-full bg-surface-2 hairline">
        <button
          aria-label={`Fewer ${label}`}
          onClick={() => onChange(Math.max(1, value - 1))}
          className="flex h-7 w-7 items-center justify-center rounded-l-full text-muted hover:text-ink"
        >
          <Minus size={13} strokeWidth={2} />
        </button>
        <span className="w-6 text-center text-small font-medium text-ink">{value}</span>
        <button
          aria-label={`More ${label}`}
          onClick={() => onChange(Math.min(8, value + 1))}
          className="flex h-7 w-7 items-center justify-center rounded-r-full text-muted hover:text-ink"
        >
          <Plus size={13} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

export function SheetSlicer({ onSlice }: { onSlice: (tiles: string[]) => void }) {
  const [sheet, setSheet] = useState<DecodedImage | null>(null);
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [detected, setDetected] = useState(false);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [slicing, setSlicing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => () => void (sheet && revokeDecoded(sheet)), [sheet]);

  const pick = useCallback((file: File) => {
    setError(null);
    decodeImageFile(file)
      .then((decoded) => {
        setSheet((prev) => {
          if (prev) revokeDecoded(prev);
          return decoded;
        });
        const grid = detectGrid(decoded.img);
        setRows(grid.rows);
        setCols(grid.cols);
        setDetected(grid.detected);
        setExcluded(new Set());
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const slice = () => {
    if (!sheet) return;
    setSlicing(true);
    // let the button paint its busy state before the sync canvas work
    requestAnimationFrame(() => {
      try {
        const tiles = sliceGrid(sheet.img, rows, cols).filter((_, i) => !excluded.has(i));
        onSlice(tiles);
      } finally {
        setSlicing(false);
      }
    });
  };

  const keptCount = rows * cols - [...excluded].filter((i) => i < rows * cols).length;

  return (
    <div className="flex flex-col gap-3 rounded-[12px] bg-surface-2 p-3 hairline">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
          e.target.value = '';
        }}
      />

      {!sheet ? (
        <button
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) pick(f);
          }}
          className={cn(
            'flex h-32 flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-[var(--line-strong)] text-muted transition-colors hover:bg-surface-3 hover:text-body',
            over && 'bg-surface-3 text-body',
          )}
        >
          <Grid3X3 size={20} strokeWidth={1.5} />
          <span className="text-small">Drop a sprite sheet (grid of frames on a plain background)</span>
        </button>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <GridStepper label="Rows" value={rows} onChange={(v) => { setRows(v); setExcluded(new Set()); }} />
            <GridStepper label="Columns" value={cols} onChange={(v) => { setCols(v); setExcluded(new Set()); }} />
            <span className="text-small text-faint">
              {detected ? 'Grid detected from the gutters — adjust if it looks off.' : 'Could not detect a grid — set it manually.'}
            </span>
            <button
              onClick={() => inputRef.current?.click()}
              className="ml-auto flex items-center gap-1.5 text-small text-muted hover:text-body"
            >
              <RefreshCw size={12} strokeWidth={1.5} /> Different sheet
            </button>
          </div>

          {/* grid overlay: click a cell to keep/exclude it */}
          <div
            className="relative mx-auto grid w-fit overflow-hidden rounded-[10px] hairline"
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          >
            <img
              src={sheet.url}
              alt="Sprite sheet"
              draggable={false}
              className="pointer-events-none col-span-full row-span-full max-h-[300px] w-auto max-w-full"
              style={{ gridArea: `1 / 1 / span ${rows} / span ${cols}` }}
            />
            {Array.from({ length: rows * cols }).map((_, i) => {
              const off = excluded.has(i);
              return (
                <button
                  key={i}
                  aria-label={`${off ? 'Include' : 'Exclude'} tile ${i + 1}`}
                  aria-pressed={!off}
                  onClick={() =>
                    setExcluded((prev) => {
                      const next = new Set(prev);
                      if (off) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                  className={cn(
                    'relative z-10 border border-[var(--line)] transition-colors',
                    off ? 'bg-[rgb(5_6_10_/_0.72)]' : 'bg-transparent hover:bg-[rgb(255_255_255_/_0.06)]',
                  )}
                  style={{ gridColumn: (i % cols) + 1, gridRow: Math.floor(i / cols) + 1 }}
                >
                  <span
                    className={cn(
                      'absolute left-1 top-1 rounded-full px-1.5 text-[10px] font-medium',
                      off ? 'bg-surface-3 text-faint' : 'bg-surface-1/85 text-body',
                    )}
                  >
                    {off ? '–' : [...Array(i + 1).keys()].filter((k) => !excluded.has(k)).length}
                  </span>
                </button>
              );
            })}
          </div>

          {error && <p className="text-small text-[var(--danger)]">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-small text-muted">Click tiles to exclude empties — order is left-to-right, top-to-bottom.</span>
            <Button size="sm" variant="primary" onClick={slice} loading={slicing} loadingLabel="Slicing…" disabled={keptCount === 0}>
              Add {keptCount} frame{keptCount === 1 ? '' : 's'}
            </Button>
          </div>
        </>
      )}
      {!sheet && error && <p className="text-small text-[var(--danger)]">{error}</p>}
    </div>
  );
}
