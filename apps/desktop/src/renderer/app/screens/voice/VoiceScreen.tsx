import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Download, Keyboard, MicOff } from 'lucide-react';
import { spring, dur } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import { useVoice, micLevelRef, ttsLevelRef } from '../../../lib/voiceStore';
import { useChat } from '../../../lib/chatStore';
import { useShell } from '../../../lib/store';
import { OrbCanvas } from '../../../orb/OrbCanvas';
import type { OrbState } from '../../../orb/orbState';
import { Button, Card, Chip, Keycap } from '../../../ui';

const stateLabel: Record<OrbState, string> = {
  idle: 'Hold Space and ask me anything',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking — talk over me to interrupt',
};

function InstallCard() {
  const { status, install, startInstall, refreshStatus } = useVoice();
  if (!status || (status.stt === 'ready' && status.tts === 'ready')) return null;
  const pct =
    install?.active && install.totalBytes > 0
      ? Math.min(100, Math.round((install.completedBytes / install.totalBytes) * 100))
      : null;

  return (
    <Card padding="compact" className="w-[420px]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-warning/10">
          <MicOff size={16} strokeWidth={1.5} className="text-warning" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-small font-medium text-ink">Voice needs a one-time setup</h3>
          <p className="mt-0.5 text-small text-muted">
            Speech recognition ({status.stt}) and voice ({status.tts}) run fully on this Mac —
            about 500 MB, then it works offline forever.
          </p>
          {install?.active && (
            <div className="mt-2">
              <div className="h-1 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="aurora-bg h-full rounded-full transition-[width]"
                  style={{ width: `${pct ?? 8}%` }}
                />
              </div>
              <p className="mt-1 font-mono text-[11px] text-faint tabular">
                {install.step}
                {pct !== null ? ` · ${pct}%` : ''}
              </p>
            </div>
          )}
          {install?.error && <p className="mt-1 text-small text-danger">{install.error}</p>}
        </div>
        {!install?.active && (
          <Button
            size="sm"
            variant="primary"
            icon={<Download size={14} strokeWidth={1.5} />}
            onClick={() => {
              void startInstall();
              void refreshStatus();
            }}
          >
            Install voice
          </Button>
        )}
      </div>
    </Card>
  );
}

export function VoiceScreen() {
  const { orb, interim, finalTranscript, reply, error, enter, leave, pttDown, pttUp, interrupt } =
    useVoice();
  const chatInit = useChat((s) => s.init);
  const setActive = useShell((s) => s.setActive);
  const reduce = useReducedMotion();
  const [spaceHeld, setSpaceHeld] = useState(false);
  const heldRef = useRef(false);

  useEffect(() => {
    chatInit();
    enter();
    return leave;
  }, [chatInit, enter, leave]);

  // In-app push-to-talk: hold Space (global ⌥Space toggle comes from the tray/hotkey).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      heldRef.current = true;
      setSpaceHeld(true);
      void pttDown();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !heldRef.current) return;
      e.preventDefault();
      heldRef.current = false;
      setSpaceHeld(false);
      pttUp();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [pttDown, pttUp]);

  // Level source follows the state machine: mic while listening, TTS while speaking.
  const levelRef = useMemo(
    () => ({
      get current() {
        const s = useVoice.getState().orb;
        if (s === 'listening') return micLevelRef.current;
        if (s === 'speaking') return ttsLevelRef.current;
        return 0;
      },
      set current(_v: number) {
        /* read-only proxy */
      },
    }),
    [],
  );

  const transcript = interim || finalTranscript;

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-8 overflow-hidden">
      {/* deep-space vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 42%, transparent 30%, var(--canvas) 85%)' }}
      />

      <div className="z-10 flex flex-col items-center gap-6">
        <OrbCanvas state={orb} levelRef={levelRef} size={340} onTap={interrupt} />

        <motion.p
          key={orb}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={reduce ? { duration: dur.micro } : spring.gentle}
          className="text-small text-muted"
        >
          {stateLabel[orb]}
        </motion.p>

        {/* Live transcript: soft while interim, solid when final (§4.3) */}
        <AnimatePresence mode="wait">
          {transcript && (
            <motion.p
              key="transcript"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: dur.micro } }}
              transition={reduce ? { duration: dur.micro } : spring.gentle}
              className={cn(
                'max-w-xl text-center text-h3 leading-relaxed',
                interim ? 'text-muted' : 'text-ink',
              )}
            >
              “{transcript}”
            </motion.p>
          )}
        </AnimatePresence>

        {reply && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: dur.micro } : spring.gentle}
            className="max-w-xl text-center text-body leading-relaxed whitespace-pre-wrap text-body select-text"
          >
            {reply}
          </motion.div>
        )}

        {error && (
          <Card padding="compact" className="border-danger/20">
            <p className="text-small text-body">{error}</p>
          </Card>
        )}

        <InstallCard />
      </div>

      {/* Controls strip */}
      <div className="z-10 flex items-center gap-5 text-[12px] text-faint">
        <span className="flex items-center gap-1.5">
          <Keycap pressed={spaceHeld}>Space</Keycap> hold to talk
        </span>
        <span className="flex items-center gap-1.5">
          <Keycap>⌥</Keycap>
          <Keycap>Space</Keycap> toggle from anywhere
        </span>
        <Chip>Wake word — later</Chip>
        <button
          onClick={() => setActive('chat')}
          className="flex items-center gap-1.5 rounded-[8px] px-2 py-1 hover:bg-surface-2 hover:text-body"
        >
          <Keyboard size={13} strokeWidth={1.5} /> Type instead
        </button>
      </div>
    </div>
  );
}
