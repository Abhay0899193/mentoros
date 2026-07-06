import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  CornerDownLeft,
  Moon,
  PanelLeft,
  Swords,
  Target,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { useShell, MODULES, DESIGN_MODULE } from "../../lib/store";
import { useTheme } from "../../theme/ThemeProvider";
import { useInterview } from "../../lib/interviewStore";
import { Overlay, Keycap } from "../../ui";

interface Action {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords?: string;
  run: () => void;
}

/** Subsequence fuzzy match — cheap and instant (<50ms budget, §4.10). */
function fuzzy(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length;
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setActive, toggleRail } = useShell();
  const { toggle: toggleTheme } = useTheme();
  const openInterviewPicker = useInterview((s) => s.openPicker);
  const openInterviewLauncher = useInterview((s) => s.openLauncher);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const actions = useMemo<Action[]>(
    () => [
      ...[...MODULES, DESIGN_MODULE].map((m) => ({
        id: `nav-${m.id}`,
        label: `Go to ${m.label}`,
        hint: m.shortcut ? `⌘${m.shortcut}` : undefined,
        icon: m.icon,
        keywords: m.id,
        run: () => setActive(m.id),
      })),
      {
        id: "interview-start-coding",
        label: "Start coding interview",
        icon: Swords,
        keywords: "interview coding leetcode practice mock",
        run: () => {
          setActive("interview");
          openInterviewPicker("coding");
          setPaletteOpen(false);
        },
      },
      {
        id: "interview-launcher",
        label: "Interviews",
        icon: Target,
        keywords: "interview coding system design sql behavioral scorecard",
        run: () => {
          setActive("interview");
          openInterviewLauncher();
          setPaletteOpen(false);
        },
      },
      {
        id: "nav-settings",
        label: "Settings",
        icon: Settings,
        keywords: "settings voice tts stt transcription mentor identity orb face preferences",
        run: () => {
          setActive("settings");
          setPaletteOpen(false);
        },
      },
      {
        id: "toggle-theme",
        label: "Toggle theme",
        icon: Moon,
        keywords: "dark light appearance",
        run: () => {
          toggleTheme();
          setPaletteOpen(false);
        },
      },
      {
        id: "toggle-rail",
        label: "Toggle sidebar",
        icon: PanelLeft,
        keywords: "collapse expand rail",
        run: () => {
          toggleRail();
          setPaletteOpen(false);
        },
      },
    ],
    [
      setActive,
      setPaletteOpen,
      toggleRail,
      toggleTheme,
      openInterviewPicker,
      openInterviewLauncher,
    ],
  );

  const results = useMemo(
    () =>
      query.trim() === ""
        ? actions
        : actions.filter((a) =>
            fuzzy(query.trim(), `${a.label} ${a.keywords ?? ""}`),
          ),
    [actions, query],
  );

  useEffect(() => setSelected(0), [query, paletteOpen]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[selected]?.run();
    }
  };

  return (
    <Overlay
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      width={640}
      align="top"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search size={16} strokeWidth={1.5} className="shrink-0 text-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command or search…"
          aria-label="Command palette"
          className="h-12 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-faint"
        />
        <Keycap>esc</Keycap>
      </div>

      <ul ref={listRef} role="listbox" className="max-h-80 overflow-y-auto p-2">
        {results.length === 0 && (
          <li className="px-3 py-8 text-center text-small text-faint">
            No matches for “{query}” — try a module name like “voice”.
          </li>
        )}
        {results.map((a, i) => {
          const Icon = a.icon;
          return (
            <li
              key={a.id}
              role="option"
              aria-selected={i === selected}
              data-selected={i === selected}
            >
              <button
                onClick={a.run}
                onMouseMove={() => setSelected(i)}
                className={cn(
                  "flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-small",
                  i === selected ? "bg-surface-2 text-ink" : "text-body",
                )}
              >
                <Icon
                  size={16}
                  strokeWidth={1.5}
                  className="shrink-0 text-muted"
                />
                <span className="flex-1 text-left">{a.label}</span>
                {a.hint && (
                  <span className="font-mono text-[11px] text-faint">
                    {a.hint}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-faint">
        <span className="flex items-center gap-1">
          <Keycap>↑</Keycap>
          <Keycap>↓</Keycap> navigate
        </span>
        <span className="flex items-center gap-1">
          <CornerDownLeft size={11} strokeWidth={1.5} /> select
        </span>
      </footer>
    </Overlay>
  );
}
