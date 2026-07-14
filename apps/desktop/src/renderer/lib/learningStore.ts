import { create } from 'zustand';
import {
  coreClient,
  type HeatCell,
  type LearningSummary,
  type LearningTask,
  type LearningWeek,
  type ReviewItem,
  type TodayMission,
} from './coreClient';
import { toast } from '../ui';

/** Stable key for a plan week (weeks repeat their number across phases). */
export function weekKey(week: Pick<LearningWeek, 'phase' | 'week'>): string {
  return `${week.phase}-${week.week}`;
}

interface LearningState {
  summary: LearningSummary | null;
  mission: TodayMission | null;
  weeks: LearningWeek[];
  reviews: ReviewItem[];
  heat: HeatCell[];
  dayTasks: Record<string, LearningTask[]>;
  dayNotes: Record<string, string | null>;

  /** Path | Stats tab (plan §E). */
  tab: 'path' | 'stats';
  /** Drill-down: weekKey of the open week page, null = overview grid. */
  openWeekKey: string | null;
  /** Level reached by the latest completion when it crossed a level — drives the overlay. */
  levelUpTo: number | null;

  init: () => void;
  refresh: () => Promise<void>;
  loadWeeks: () => Promise<void>;
  loadDayTasks: (dayId: string) => Promise<void>;
  loadDayNotes: (dayId: string) => Promise<void>;
  completeMissionItem: (itemId: string, done: boolean) => Promise<void>;
  completeTask: (taskId: string, done: boolean) => Promise<void>;
  setTab: (tab: 'path' | 'stats') => void;
  openWeek: (key: string | null) => void;
  clearLevelUp: () => void;
}

let initialized = false;

export const useLearning = create<LearningState>((set, get) => ({
  summary: null,
  mission: null,
  weeks: [],
  reviews: [],
  heat: [],
  dayTasks: {},
  dayNotes: {},
  tab: 'path',
  openWeekKey: null,
  levelUpTo: null,

  init: () => {
    if (!initialized) {
      initialized = true;
      coreClient.on('learning.progress', ({ summary }) => set({ summary }));
      coreClient.on('mission.updated', ({ mission }) => set({ mission }));
      coreClient.on('import.progress', ({ source, done }) => {
        if (source === '3mc' && done) {
          set({ dayTasks: {}, dayNotes: {} }); // re-import refreshes notes/resources
          void get().loadWeeks();
          void get().refresh();
        }
      });
    }
    void get().refresh();
  },

  refresh: async () => {
    try {
      const [summary, mission, reviews, heat] = await Promise.all([
        coreClient.learningSummary(),
        coreClient.todayMission(),
        coreClient.reviewQueue(),
        coreClient.heatmap(84),
      ]);
      set({ summary, mission, reviews, heat });
    } catch {
      /* learning routes not up yet — screens show designed empty states */
    }
  },

  loadWeeks: async () => {
    try {
      set({ weeks: await coreClient.learningWeeks() });
    } catch {
      set({ weeks: [] });
    }
  },

  loadDayTasks: async (dayId) => {
    const tasks = await coreClient.learningDayTasks(dayId);
    set((s) => ({ dayTasks: { ...s.dayTasks, [dayId]: tasks } }));
  },

  loadDayNotes: async (dayId) => {
    if (get().dayNotes[dayId] !== undefined) return;
    const { notes } = await coreClient.learningDayNotes(dayId);
    set((s) => ({ dayNotes: { ...s.dayNotes, [dayId]: notes } }));
  },

  completeMissionItem: async (itemId, done) => {
    const mission = await coreClient.completeMissionItem(itemId, done);
    set({ mission });
  },

  completeTask: async (taskId, done) => {
    const before = get().summary;
    const summary = await coreClient.completeTask(taskId, done);
    set({ summary });
    // XP juice (plan §E): the earned delta is server-derived (task + any bonuses
    // the completion unlocked), so the toast never lies about bonus XP.
    if (done && before) {
      const delta = summary.xp - before.xp;
      const worth = Object.values(get().dayTasks)
        .flat()
        .find((t) => t.id === taskId)?.xpWorth;
      const bonus = worth !== undefined ? delta - worth : 0;
      const milestone =
        bonus >= 250 ? 'Week complete! ' : bonus >= 50 ? 'Perfect day! ' : '';
      if (summary.level > before.level) {
        set({ levelUpTo: summary.level });
      } else if (delta > 0) {
        toast({
          tone: 'success',
          title: `+${delta.toLocaleString()} XP`,
          description:
            milestone +
            (summary.xpToNext > 0
              ? `${(summary.xpToNext - summary.xpIntoLevel).toLocaleString()} XP to Level ${summary.level + 1}`
              : 'Level cap reached'),
        });
      }
    }
    // refresh any loaded day list containing the task
    const { dayTasks } = get();
    for (const [dayId, tasks] of Object.entries(dayTasks)) {
      if (tasks.some((t) => t.id === taskId)) void get().loadDayTasks(dayId);
    }
    void get().loadWeeks(); // week tiles/day counts re-derive
  },

  setTab: (tab) => set({ tab }),
  openWeek: (key) => set({ openWeekKey: key }),
  clearLevelUp: () => set({ levelUpTo: null }),
}));
