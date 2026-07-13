import { create } from 'zustand';
import {
  coreClient,
  type HeatCell,
  type LearningSummary,
  type LearningTask,
  type LearningWeek,
  type ProgressImportResult,
  type ReviewItem,
  type TodayMission,
} from './coreClient';

interface LearningState {
  summary: LearningSummary | null;
  mission: TodayMission | null;
  weeks: LearningWeek[];
  reviews: ReviewItem[];
  heat: HeatCell[];
  dayTasks: Record<string, LearningTask[]>;
  dayNotes: Record<string, string | null>;

  init: () => void;
  refresh: () => Promise<void>;
  loadWeeks: () => Promise<void>;
  loadDayTasks: (dayId: string) => Promise<void>;
  loadDayNotes: (dayId: string) => Promise<void>;
  importProgress: (progress: unknown) => Promise<ProgressImportResult>;
  completeMissionItem: (itemId: string, done: boolean) => Promise<void>;
  completeTask: (taskId: string, done: boolean) => Promise<void>;
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

  importProgress: async (progress) => {
    const result = await coreClient.importLearningProgress(progress);
    set({ summary: result.summary, dayTasks: {} }); // task lists are stale now
    await Promise.all([get().loadWeeks(), get().refresh()]);
    return result;
  },

  completeMissionItem: async (itemId, done) => {
    const mission = await coreClient.completeMissionItem(itemId, done);
    set({ mission });
  },

  completeTask: async (taskId, done) => {
    const summary = await coreClient.completeTask(taskId, done);
    set({ summary });
    // refresh any loaded day list containing the task
    const { dayTasks } = get();
    for (const [dayId, tasks] of Object.entries(dayTasks)) {
      if (tasks.some((t) => t.id === taskId)) void get().loadDayTasks(dayId);
    }
  },
}));
