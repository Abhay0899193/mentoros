import { useState } from 'react';
import { Check, Copy, MessageCircleQuestion } from 'lucide-react';
import { cn } from '../../../lib/cn';

export interface CodeBlockProps {
  code: string;
  lang?: string;
  /** Pre-fills the composer with "Explain this line" for the clicked line. */
  onExplainLine?: (line: string) => void;
}

export function CodeBlock({ code, lang, onExplainLine }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lines = code.replace(/\n$/, '').split('\n');

  const copy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group/code my-3 overflow-hidden rounded-[10px] bg-surface-2 hairline">
      <div className="flex h-8 items-center justify-between border-b border-line px-3">
        <span className="font-mono text-[11px] text-faint">{lang || 'code'}</span>
        <button
          onClick={copy}
          aria-label="Copy code"
          className="flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] text-faint hover:bg-surface-3 hover:text-body"
        >
          {copied ? (
            <Check size={12} strokeWidth={1.5} className="text-success" />
          ) : (
            <Copy size={12} strokeWidth={1.5} />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-mono leading-relaxed text-body select-text">
        {lines.map((line, i) => (
          <div key={i} className="group/line relative flex min-h-[1.5em] items-start pr-6">
            <span className="flex-1 whitespace-pre">{line || ' '}</span>
            {onExplainLine && line.trim() !== '' && (
              <button
                onClick={() => onExplainLine(line)}
                aria-label={`Explain line ${i + 1}`}
                title="Explain this line"
                className={cn(
                  'absolute top-0.5 right-0 rounded-[4px] p-0.5 text-faint opacity-0',
                  'group-hover/line:opacity-100 hover:bg-surface-3 hover:text-body',
                )}
              >
                <MessageCircleQuestion size={13} strokeWidth={1.5} />
              </button>
            )}
          </div>
        ))}
      </pre>
    </div>
  );
}
