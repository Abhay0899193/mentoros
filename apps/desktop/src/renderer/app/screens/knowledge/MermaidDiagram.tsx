import { useEffect, useState } from 'react';
import { CodeBlock } from '../chat/CodeBlock';

/**
 * Renders a ```mermaid fence as an inline SVG themed with the Nocturne tokens.
 * The mermaid bundle is heavy, so it is lazy-imported on first render and the
 * chunk never loads for documents without diagrams. A parse/render failure
 * falls back to the plain code block — a broken diagram must never break the
 * reading view.
 */

let renderSeq = 0;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Nocturne → mermaid `base` theme variables, resolved from the live tokens. */
function themeVariables(): Record<string, string> {
  const surface2 = cssVar('--surface-2');
  return {
    background: cssVar('--surface-1'),
    primaryColor: surface2,
    primaryTextColor: cssVar('--ink'),
    primaryBorderColor: cssVar('--line-strong'),
    secondaryColor: cssVar('--surface-3'),
    tertiaryColor: surface2,
    lineColor: cssVar('--muted'),
    textColor: cssVar('--body'),
    edgeLabelBackground: cssVar('--surface-1'),
    clusterBkg: cssVar('--surface-1'),
    clusterBorder: cssVar('--line-strong'),
    fontSize: '14px',
  };
}

/** Bumps on data-theme / data-accent flips so open diagrams re-render themed. */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-accent'],
    });
    return () => observer.disconnect();
  }, []);
  return version;
}

export function MermaidDiagram({ code }: { code: string }) {
  const themeVersion = useThemeVersion();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = `nocturne-mermaid-${++renderSeq}`;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          themeVariables: themeVariables(),
          fontFamily: getComputedStyle(document.body).fontFamily,
        });
        const rendered = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(rendered.svg);
          setFailed(false);
        }
      } catch {
        // mermaid can leave an orphan error element behind on a parse failure
        document.getElementById(`d${id}`)?.remove();
        document.getElementById(id)?.remove();
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, themeVersion]);

  if (failed) return <CodeBlock code={code} lang="mermaid" />;
  if (!svg) {
    return (
      <div className="my-4 rounded-[10px] bg-surface-1 px-4 py-6 text-label text-faint hairline">
        Rendering diagram…
      </div>
    );
  }
  return (
    <div
      className="my-4 overflow-x-auto rounded-[10px] bg-surface-1 p-4 hairline [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      role="img"
      // Mermaid output is generated SVG from sanitized (securityLevel: strict) input.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
