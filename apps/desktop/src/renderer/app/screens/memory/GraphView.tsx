import { useCallback, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods, NodeObject } from 'react-force-graph-2d';
import { useMemories } from '../../../lib/memoryStore';
import type { MemoryType } from '../../../lib/coreClient';
import { useTheme } from '../../../theme/ThemeProvider';
import { TYPE_COLOR, TYPE_ORDER, typeLabel } from './memoryMeta';
import { cn } from '../../../lib/cn';

interface GNode extends NodeObject {
  id: string;
  type: MemoryType;
  title: string;
  confidence: number;
}

/** Force-directed memory graph (§4.4). Node color = memory type (validated
 * categorical palette); identity is never color-alone — legend + tooltip + list. */
export function GraphView({ width, height }: { width: number; height: number }) {
  const { graph, query, select } = useMemories();
  const { theme } = useTheme();
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [hover, setHover] = useState<{ node: GNode; x: number; y: number } | null>(null);

  const data = useMemo(
    () => ({
      nodes: (graph?.nodes ?? []).map((n) => ({ ...n })) as GNode[],
      links: (graph?.edges ?? []).map((e) => ({ source: e.source, target: e.target })),
    }),
    [graph],
  );

  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (n: GNode) => q === '' || n.title.toLowerCase().includes(q) || n.type.includes(q),
    [q],
  );

  const line = theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(10,11,15,0.12)';
  const dimAlpha = theme === 'dark' ? 0.12 : 0.15;
  const labelInk = theme === 'dark' ? 'rgba(245,247,250,0.85)' : 'rgba(18,20,26,0.85)';

  const drawNode = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D, scale: number) => {
      const n = node as GNode;
      const dim = !matches(n);
      const r = 3 + n.confidence * 4;
      ctx.globalAlpha = dim ? dimAlpha : 1;
      ctx.beginPath();
      ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
      ctx.fillStyle = TYPE_COLOR[n.type];
      ctx.fill();
      // hairline ring = contrast relief on light surfaces
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = line;
      ctx.stroke();
      if (!dim && (scale > 1.6 || n.confidence >= 0.9)) {
        ctx.font = `${Math.max(3.2, 11 / scale)}px "Inter Variable", sans-serif`;
        ctx.fillStyle = labelInk;
        ctx.textAlign = 'center';
        ctx.fillText(
          n.title.length > 34 ? `${n.title.slice(0, 33)}…` : n.title,
          n.x!,
          n.y! + r + Math.max(4, 12 / scale),
        );
      }
      ctx.globalAlpha = 1;
    },
    [matches, line, labelInk, dimAlpha],
  );

  const presentTypes = useMemo(() => {
    const s = new Set((graph?.nodes ?? []).map((n) => n.type));
    return TYPE_ORDER.filter((t) => s.has(t));
  }, [graph]);

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-h3 text-ink">No memories yet</p>
        <p className="max-w-sm text-small text-muted">
          Tell the mentor about yourself in Chat or Voice, or import your interview-prep data —
          each fact becomes a node here.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {/* Legend — identity never color-alone */}
      <div className="absolute top-2 left-2 z-10 flex max-w-full flex-wrap gap-x-3 gap-y-1 rounded-[10px] bg-canvas/70 px-2 py-1 backdrop-blur-sm">
        {presentTypes.map((t) => (
          <span key={t} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[t] }} />
            {typeLabel(t)}
          </span>
        ))}
      </div>

      <ForceGraph2D
        ref={fgRef}
        width={width}
        height={height}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={(node, color, ctx) => {
          const n = node as GNode;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, 3 + n.confidence * 4 + 4, 0, 2 * Math.PI); // hit area > mark
          ctx.fillStyle = color;
          ctx.fill();
        }}
        linkColor={() => line}
        linkWidth={1}
        onNodeHover={(node) => {
          if (!node) return setHover(null);
          const n = node as GNode;
          const coords = fgRef.current?.graph2ScreenCoords(n.x!, n.y!);
          if (coords) setHover({ node: n, x: coords.x, y: coords.y });
        }}
        onNodeClick={(node) => select((node as GNode).id)}
        onBackgroundClick={() => select(null)}
        cooldownTicks={120}
        warmupTicks={60}
      />

      {hover && (
        <div
          className={cn('glass overlay-shadow pointer-events-none absolute z-20 rounded-[10px] bg-surface-1/85 px-3 py-2')}
          style={{ left: hover.x + 12, top: hover.y + 12, maxWidth: 280 }}
        >
          <div className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: TYPE_COLOR[hover.node.type] }} />
            <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">
              {typeLabel(hover.node.type)}
            </span>
          </div>
          <p className="mt-0.5 text-small text-ink">{hover.node.title}</p>
          <p className="font-mono text-[11px] text-faint tabular">
            confidence {Math.round(hover.node.confidence * 100)}%
          </p>
        </div>
      )}
    </div>
  );
}
