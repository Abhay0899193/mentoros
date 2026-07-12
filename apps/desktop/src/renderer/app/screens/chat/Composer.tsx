import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Mic, ArrowUp, Square } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { useIsTouch } from '../../../lib/useBreakpoint';
import { Keycap } from '../../../ui';

export interface ComposerHandle {
  /** Pre-fill and focus (used by "explain this line" and prompt chips). */
  setDraft: (text: string, send?: boolean) => void;
}

export interface ComposerProps {
  disabled?: boolean;
  generating: boolean;
  onSend: (content: string) => void;
  onStop: () => void;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { disabled, generating, onSend, onStop },
  ref,
) {
  const [value, setValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const isTouch = useIsTouch();

  const submit = () => {
    const content = value.trim();
    if (!content || disabled || generating) return;
    setValue('');
    onSend(content);
  };

  useImperativeHandle(ref, () => ({
    setDraft: (text, send = false) => {
      if (send) {
        if (!disabled && !generating) onSend(text);
        return;
      }
      setValue(text);
      requestAnimationFrame(() => {
        taRef.current?.focus();
        taRef.current?.setSelectionRange(text.length, text.length);
      });
    },
  }));

  return (
    <div
      className={cn(
        'flex items-end gap-2 rounded-[14px] bg-surface-1 hairline p-2 pl-4',
        'focus-within:border-line-strong',
        disabled && 'opacity-60',
      )}
    >
      <textarea
        ref={taRef}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
        }}
        onKeyDown={(e) => {
          // A phone keyboard has no Shift+Enter, so Enter-to-send would make a
          // multi-line message impossible to type. On touch, Return is a
          // newline and the send button is the only way to send.
          if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
            e.preventDefault();
            submit();
          }
        }}
        enterKeyHint={isTouch ? 'enter' : 'send'}
        placeholder={disabled ? 'The local model is unavailable…' : 'Ask your mentor anything…'}
        aria-label="Message"
        className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-body text-ink outline-none placeholder:text-faint"
      />
      <div className="flex items-center gap-1 pb-0.5">
        <span className="mr-1 hidden items-center gap-1 sm:flex">
          <Keycap>⏎</Keycap>
          <span className="text-[11px] text-faint">send</span>
        </span>
        <button
          aria-label="Voice input (arrives in Stage 1c)"
          title="Voice arrives in Stage 1c"
          disabled
          className="tap-target flex items-center justify-center rounded-[10px] p-2 text-faint opacity-50"
        >
          <Mic size={18} strokeWidth={1.5} />
        </button>
        {generating ? (
          <button
            onClick={onStop}
            aria-label="Stop generating"
            className="tap-target flex items-center justify-center rounded-[10px] bg-surface-2 hairline p-2 text-ink hover:bg-surface-3"
          >
            <Square size={16} strokeWidth={1.5} />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={disabled || value.trim() === ''}
            aria-label="Send"
            className={cn(
              'tap-target flex items-center justify-center rounded-[10px] p-2',
              value.trim() !== '' && !disabled
                ? 'bg-ink text-canvas hover:opacity-90'
                : 'bg-surface-2 text-faint',
            )}
          >
            <ArrowUp size={18} strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
});
