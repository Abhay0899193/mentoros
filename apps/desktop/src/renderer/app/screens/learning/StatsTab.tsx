import { Award, CalendarCheck, Flame, Swords, type LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { riseIn, reduced } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import { Card, Chip } from '../../../ui';
import type { HeatCell, LearningSummary, ReviewItem } from '../../../lib/coreClient';
import { HeatStrip } from './HeatStrip';
import { ReviewQueue } from './ReviewQueue';
import { WeeklyXpChart } from './WeeklyXpChart';

interface Badge {
  id: string;
  label: string;
  detail: string;
  icon: LucideIcon;
  earned: boolean;
}

/** Milestone badges — all derived from summary, same facts the XP engine uses. */
function buildBadges(summary: LearningSummary): Badge[] {
  const { streak, doneDays, level } = summary;
  return [
    { id: 'streak-7', label: '7-day streak', detail: '+100 XP milestone', icon: Flame, earned: streak.best >= 7 },
    { id: 'streak-14', label: '14-day streak', detail: '+200 XP milestone', icon: Flame, earned: streak.best >= 14 },
    { id: 'streak-30', label: '30-day streak', detail: '+500 XP milestone', icon: Flame, earned: streak.best >= 30 },
    { id: 'days-10', label: '10 perfect days', detail: 'every task of the day', icon: CalendarCheck, earned: doneDays >= 10 },
    { id: 'days-50', label: '50 perfect days', detail: 'every task of the day', icon: CalendarCheck, earned: doneDays >= 50 },
    { id: 'level-10', label: 'Level 10', detail: 'keep climbing', icon: Award, earned: level >= 10 },
    { id: 'level-25', label: 'Level 25', detail: 'halfway to the cap', icon: Award, earned: level >= 25 },
  ];
}

/** Stats tab (plan §E): heatmap, weekly XP chart, daily quests, badges, reviews. */
export function StatsTab({
  summary,
  heat,
  reviews,
}: {
  summary: LearningSummary;
  heat: HeatCell[];
  reviews: ReviewItem[];
}) {
  const reduce = useReducedMotion();
  const badges = buildBadges(summary);
  const earned = badges.filter((b) => b.earned);

  return (
    <motion.div variants={reduced(reduce, riseIn)} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card padding="compact" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-h2 text-ink">Activity</h2>
            <span className="font-mono text-[12px] text-muted tabular">
              {summary.todayXp > 0 ? `+${summary.todayXp.toLocaleString()} XP today` : 'no XP yet today'}
            </span>
          </div>
          <HeatStrip heat={heat} />
        </Card>

        <Card padding="compact" className="flex flex-col gap-3">
          <h2 className="text-h2 text-ink">XP per week</h2>
          <WeeklyXpChart weeklyXp={summary.weeklyXp} />
        </Card>
      </div>

      <Card padding="compact" className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Swords size={15} strokeWidth={1.5} className="text-muted" />
          <h2 className="text-h2 text-ink">Today’s quests</h2>
        </div>
        {summary.quests.length === 0 ? (
          <p className="text-small text-faint">
            No quests yet today — they appear once your daily mission is generated on Home.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {summary.quests.map((q) => (
              <li key={q.id} className="flex items-center gap-3 rounded-[8px] px-2 py-1.5">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    q.done ? 'aurora-bg' : 'hairline-strong bg-surface-2',
                  )}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-small',
                    q.done ? 'text-faint line-through' : 'text-ink',
                  )}
                >
                  {q.label}
                </span>
                <Chip className="shrink-0 uppercase">{q.kind}</Chip>
                <span
                  className={cn(
                    'shrink-0 font-mono text-[12px] tabular',
                    q.done ? 'text-faint' : 'text-[var(--iris)]',
                  )}
                >
                  +{q.xp}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padding="compact" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-h2 text-ink">Badges</h2>
          <span className="font-mono text-[12px] text-muted tabular">
            {earned.length}/{badges.length}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {badges.map((b) => (
            <div
              key={b.id}
              className={cn(
                'flex items-center gap-2.5 rounded-[10px] bg-surface-1 p-3',
                b.earned ? 'hairline-strong' : 'hairline opacity-50',
              )}
              title={b.earned ? `${b.label} — earned` : `${b.label} — not yet`}
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full',
                  b.earned ? 'aurora-bg' : 'bg-surface-2',
                )}
              >
                <b.icon size={14} strokeWidth={1.5} className={b.earned ? 'text-white' : 'text-faint'} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-ink">{b.label}</p>
                <p className="truncate text-[11px] text-faint">{b.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {reviews.length > 0 && <ReviewQueue reviews={reviews} />}
    </motion.div>
  );
}
