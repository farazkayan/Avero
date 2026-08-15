import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import GhostLink from "../components/ui/GhostLink";
import Spinner from "../components/ui/Spinner";
import EmptyState from "../components/ui/EmptyState";
import { AchievementIcon, SparkleIcon } from "../components/ui/icons";
import {
  fetchAchievementsWithState,
  fetchMemoryMonthHistogram,
  fetchSpaceStats,
  type MonthBucket,
} from "../lib/stats";
import { supabase } from "../lib/supabase";
import {
  AUTHENTICATED_HOME_PATH,
  spaceDetailPath,
  spaceSettingsPath,
} from "../constants/routes";
import type { AchievementWithState, SpaceStats } from "../types/stats";
import type { Space } from "../types/space";

/**
 * Space Statistics & Achievements (SPEC A).
 *
 * A secondary view reached from within a Space (alongside Settings), not a new
 * top-level nav item (design-system §5: "one primary focus per screen"). It
 * presents a Space's history retrospectively and reflectively — never as
 * actionable "do more" prompts. There are no streaks, no progress-toward-badge
 * nudges, no leaderboards (blueprint §10 "Build for the Memory, Not the
 * Moment", §8 "Every Feature Earns Its Place", and the "Avero Is Not" section).
 *
 * Layout (SPEC A.4), top to bottom:
 *   1. Header strip — Space name + a one-line summary in the mono font
 *      (design-system §3: mono is reserved for stat numbers/counts).
 *   2. Key numbers grid — large stat tiles (elevation-raised cards).
 *   3. Timeline density visualization — a calm monthly bar chart, monochrome
 *      with a single brass accent for the peak month. Built as a real React
 *      component with CSS (no charting library — recharts is not a dependency
 *      and SPEC A.4 says not to add one).
 *   4. Achievements grid — unlocked in full color with unlock date; locked
 *      dimmed with the title visible but the description hidden behind a
 *      subtle hint, so it never reads as a demotivating checklist.
 *   5. Supplementary facts — most active month / most-used tag as sentences
 *      (blueprint §3 "Story Over Chronology").
 *
 * Empty state: a brand-new Space with 0 Memories shows an inviting message,
 * not a grid of zeros and grayed icons that reads like failure (design-system
 * §"Empty states should inspire", blueprint Product Principle #6).
 *
 * All reads are RLS-gated by is_space_member(); a non-member receives no rows
 * and the page resolves to a calm "not found / no access" state.
 */
export default function SpaceStatsPage() {
  const { spaceId } = useParams();

  const [space, setSpace] = useState<Space | null>(null);
  const [stats, setStats] = useState<SpaceStats | null>(null);
  const [achievements, setAchievements] = useState<AchievementWithState[]>([]);
  const [histogram, setHistogram] = useState<MonthBucket[]>([]);
  const [mostUsedTagName, setMostUsedTagName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;

    async function load(id: string) {
      setIsLoading(true);
      setNotFound(false);
      setLoadError(undefined);

      try {
        // Fetch the Space (for the header) in parallel with the stats data.
        const [spaceRes, statsRow, ach, hist] = await Promise.all([
          supabase.from("spaces").select("*").eq("id", id).maybeSingle(),
          fetchSpaceStats(id).catch(() => null),
          fetchAchievementsWithState(id).catch(() => [] as AchievementWithState[]),
          fetchMemoryMonthHistogram(id).catch(() => [] as MonthBucket[]),
        ]);

        if (cancelled) return;

        if (spaceRes.error) {
          if (spaceRes.error.code === "22P02") {
            setNotFound(true);
          } else {
            setLoadError("We couldn't load these stats. Please try again.");
          }
          return;
        }
        if (!spaceRes.data) {
          // RLS returned no rows — not a member or doesn't exist.
          setNotFound(true);
          return;
        }

        setSpace(spaceRes.data as Space);
        setStats(statsRow ?? emptyStats(id));
        setAchievements(ach);
        setHistogram(hist);

        // Resolve the most-used tag's name (the cache stores only the id).
        const tagId = statsRow?.most_used_tag_id ?? null;
        if (tagId) {
          const { data: tagRow } = await supabase
            .from("tags")
            .select("name")
            .eq("id", tagId)
            .maybeSingle();
          if (!cancelled) {
            setMostUsedTagName(tagRow?.name ?? null);
          }
        } else if (!cancelled) {
          setMostUsedTagName(null);
        }
      } catch {
        if (!cancelled) {
          setLoadError("We couldn't load these stats. Please try again.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load(spaceId);
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // --- Derived display values -------------------------------------------------
  const hasMemories = (stats?.total_memories ?? 0) > 0;
  const spaceAgeYears = useMemo(() => {
    const days = stats?.space_age_days ?? 0;
    return Math.floor(days / 365);
  }, [stats?.space_age_days]);

  const unlockedCount = useMemo(
    () => achievements.filter((a) => a.unlockedAt !== null).length,
    [achievements],
  );

  if (!spaceId) {
    return null;
  }

  return (
    <>
      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* Back link */}
        <div className="mb-6">
          <GhostLink to={spaceDetailPath(spaceId)}>Back to timeline</GhostLink>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-accent-400">
            <Spinner size={28} />
          </div>
        ) : notFound ? (
          <div className="rounded-xl border border-ink/5 bg-canvas-soft p-8 text-center">
            <p className="text-sm text-ink-muted">
              We couldn't find this Space, or you don't have access to it.
            </p>
            <div className="mt-6">
              <GhostLink to={AUTHENTICATED_HOME_PATH}>Back to Spaces</GhostLink>
            </div>
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-ink/5 bg-canvas-soft p-6 text-center">
            <p className="text-sm text-error">{loadError}</p>
          </div>
        ) : space && stats ? (
          <>
            {/* 1. Header strip — Space name + one-line summary (mono numerals) */}
            <section>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="break-words text-2xl font-bold leading-tight text-ink sm:text-3xl">
                    {space.name}
                  </h1>
                  <p className="mt-2 font-mono text-sm text-ink-muted">
                    {hasMemories
                      ? `${stats.total_memories} memories · ${spaceAgeYears > 0 ? `${spaceAgeYears} year${spaceAgeYears === 1 ? "" : "s"}` : "less than a year"} together`
                      : "Your story starts here"}
                  </p>
                </div>
                {spaceId && (
                  <Link
                    to={spaceSettingsPath(spaceId)}
                    aria-label="Space settings"
                    className="inline-flex shrink-0 items-center justify-center rounded-full size-10 bg-canvas-soft hover:bg-canvas-raised text-ink-muted transition-colors duration-200 hover:text-accent-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                  >
                    <SettingsGlyph />
                  </Link>
                )}
              </div>
            </section>

            {hasMemories ? (
              <>
                {/* 2. Key numbers grid */}
                <section className="mt-10">
                  <h2 className="mb-4 font-mono-label text-mono-label text-ink-muted tracking-wider uppercase">
                    The story so far
                  </h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <StatTile label="Memories" value={stats.total_memories} />
                    <StatTile
                      label="Photos & videos"
                      value={stats.total_media}
                    />
                    <StatTile label="Comments" value={stats.total_comments} />
                    <StatTile label="Reactions" value={stats.total_reactions} />
                    <StatTile label="Members" value={stats.member_count} />
                    <StatTile
                      label="Days old"
                      value={stats.space_age_days}
                    />
                  </div>
                </section>

                {/* 3. Timeline density visualization */}
                {histogram.length > 0 && (
                  <section className="mt-12">
                    <h2 className="mb-4 font-mono-label text-mono-label text-ink-muted tracking-wider uppercase">
                      Memories over time
                    </h2>
                    <TimelineDensity buckets={histogram} />
                  </section>
                )}

                {/* 4. Achievements grid */}
                <section className="mt-12">
                  <div className="mb-4 flex items-baseline justify-between">
                    <h2 className="font-mono-label text-mono-label text-ink-muted tracking-wider uppercase">
                      Achievements
                    </h2>
                    <span className="font-mono-data text-mono-data text-ink-muted">
                      {unlockedCount} / {achievements.length}
                    </span>
                  </div>
                  <AchievementsGrid achievements={achievements} />
                </section>

                {/* 5. Supplementary facts — sentences, not raw numbers */}
                <section className="mt-12 space-y-3">
                  {stats.most_active_month && (
                    <FactSentence>
                      Your most memory-filled month was{" "}
                      <strong className="font-medium text-ink">
                        {formatMonth(stats.most_active_month)}
                      </strong>
                      .
                    </FactSentence>
                  )}
                  {mostUsedTagName && (
                    <FactSentence>
                      Your most-used tag is{" "}
                      <strong className="font-medium text-ink">
                        {mostUsedTagName}
                      </strong>
                      .
                    </FactSentence>
                  )}
                  {stats.longest_gap_days !== null &&
                    stats.longest_gap_days > 0 && (
                      <FactSentence>
                        The longest stretch between memories was{" "}
                        <strong className="font-medium text-ink">
                          {stats.longest_gap_days} day
                          {stats.longest_gap_days === 1 ? "" : "s"}
                        </strong>
                        .
                      </FactSentence>
                    )}
                </section>
              </>
            ) : (
              /* Empty state — inviting, not a grid of zeros (SPEC A.4) */
              <EmptyState
                icon={<SparkleIcon />}
                title="Your story starts here"
                titleAs="h2"
                description="Add your first Memory to see this Space's story come to life — the moments, the milestones, and the shape of your time together."
              >
                <Link
                  to={spaceDetailPath(space.id)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  Add your first memory
                </Link>
              </EmptyState>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}

// ----------------------------------------------------------------------------
// Presentational sub-components
// ----------------------------------------------------------------------------

/** A single large stat tile — number in mono, label in sans (design-system §3). */
function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-ink/5 bg-canvas-soft p-6 hover:-translate-y-0.5 transition-transform duration-300">
      <div className="font-mono-data text-mono-data text-accent-500 dark:text-accent-400 text-3xl font-semibold tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className="mt-1 font-body-sm text-body-sm text-ink-muted">{label}</div>
    </div>
  );
}

/**
 * The timeline density visualization — a calm monthly bar chart, monochrome
 * with a single brass accent for the peak month (design-system motion/color
 * restraint). Built as plain React + CSS; no charting library (SPEC A.4:
 * recharts is not a dependency, and we don't add one).
 *
 * Bars are sized relative to the peak month's count. Zero-count months render
 * as a faint baseline so the shape of the timeline reads truthfully. The chart
 * is horizontally scrollable on narrow screens rather than squished, so month
 * labels stay legible.
 */
function TimelineDensity({ buckets }: { buckets: MonthBucket[] }) {
  const peak = useMemo(
    () => buckets.reduce((max, b) => (b.count > max ? b.count : max), 0),
    [buckets],
  );
  const peakMonth = useMemo(
    () => buckets.find((b) => b.count === peak && peak > 0)?.month ?? null,
    [buckets, peak],
  );

  return (
    <div className="rounded-xl border border-ink/5 bg-canvas-soft p-6 md:p-8">
      <div className="overflow-x-auto">
        <div
          className="flex h-32 md:h-48 min-w-full items-end gap-1"
          role="img"
          aria-label="Memory count by month"
        >
          {buckets.map((b) => {
            const heightPct = peak > 0 ? Math.max(b.count / peak, 0.04) : 0.04;
            const isPeak = b.month === peakMonth;
            return (
              <div
                key={b.month}
                className="group relative flex flex-1 flex-col items-center justify-end"
                style={{ minWidth: 8 }}
                title={`${formatMonth(b.month)}: ${b.count} memor${b.count === 1 ? "y" : "ies"}`}
              >
                <div
                  className={
                    "w-full rounded-t-sm transition-colors duration-200 " +
                    (b.count === 0
                      ? "bg-ink/10"
                      : isPeak
                        ? "bg-accent-500"
                        : "bg-ink/30 group-hover:bg-ink/40")
                  }
                  style={{ height: `${heightPct * 100}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-4 flex justify-between font-mono-data text-mono-data text-ink-muted">
        <span>{formatMonth(buckets[0].month)}</span>
        <span>{formatMonth(buckets[buckets.length - 1].month)}</span>
      </div>
    </div>
  );
}

/**
 * The achievements grid. Unlocked achievements show in full color with their
 * unlock date (mono, small, muted). Locked achievements are dimmed/grayscale
 * with the title still visible but the description replaced by a subtle hint,
 * so the grid never reads as a demotivating checklist (SPEC A.4). Each card
 * follows the `.hover-lift` pattern (design-system §7).
 */
function AchievementsGrid({
  achievements,
}: {
  achievements: AchievementWithState[];
}) {
  // Group by category, preserving the catalog's (category, sort_order) order.
  const grouped = useMemo(() => {
    const map = new Map<string, AchievementWithState[]>();
    for (const a of achievements) {
      const list = map.get(a.category) ?? [];
      list.push(a);
      map.set(a.category, list);
    }
    return map;
  }, [achievements]);

  const categoryLabels: Record<string, string> = {
    milestone: "Milestones",
    time: "Time",
    collaboration: "Collaboration",
    variety: "Variety",
  };

  return (
    <div className="space-y-8">
      {(["milestone", "time", "collaboration", "variety"] as const).map(
        (category) => {
          const list = grouped.get(category);
          if (!list || list.length === 0) return null;
          return (
            <div key={category}>
              <h3 className="mb-3 font-mono-label text-mono-label text-ink-muted tracking-wider">
                <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent-500 align-middle opacity-60 dark:bg-accent-400" />
                {categoryLabels[category]}
              </h3>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {list.map((a) => (
                  <li key={a.id}>
                    <AchievementCard achievement={a} />
                  </li>
                ))}
              </ul>
            </div>
          );
        },
      )}
    </div>
  );
}

/** A single achievement card — unlocked (full color) or locked (dimmed). */
function AchievementCard({ achievement }: { achievement: AchievementWithState }) {
  const unlocked = achievement.unlockedAt !== null;
  return (
    <div
      className={
        "hover-lift flex h-full flex-col rounded-xl border p-5 transition-colors duration-300 " +
        (unlocked
          ? "border-accent-500/30 bg-canvas-soft"
          : "border-ink/5 bg-canvas-soft opacity-80")
      }
    >
      <div
        className={
          "relative mb-3 flex h-12 w-12 items-center justify-center rounded-full " +
          (unlocked
            ? "bg-accent-soft text-accent-400"
            : "bg-ink/5 text-ink-muted grayscale")
        }
        aria-hidden="true"
      >
        {unlocked && (
          <div className="absolute inset-0 rounded-full bg-accent-500/20 blur-md dark:bg-accent-400/10" />
        )}
        <AchievementIcon name={achievement.icon} className="relative z-10 h-6 w-6" />
      </div>
      <div className="font-headline-md text-headline-md text-ink">{achievement.title}</div>
      <div className="mt-1 font-mono-label text-mono-label text-ink-muted">
        {unlocked ? (
          <span>{formatUnlockDate(achievement.unlockedAt!)}</span>
        ) : (
          <span className="italic">Not yet</span>
        )}
      </div>
    </div>
  );
}

/** A supplementary fact rendered as a calm sentence. */
function FactSentence({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-ink-muted sm:text-base">{children}</p>
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** A zeroed stats object, used when the cache row is absent (e.g. brand-new). */
function emptyStats(spaceId: string): SpaceStats {
  return {
    space_id: spaceId,
    total_memories: 0,
    total_media: 0,
    total_photos: 0,
    total_videos: 0,
    total_comments: 0,
    total_reactions: 0,
    member_count: 0,
    first_memory_date: null,
    last_memory_date: null,
    most_active_month: null,
    most_used_tag_id: null,
    most_used_tag_count: null,
    longest_gap_days: null,
    space_age_days: 0,
    computed_at: new Date().toISOString(),
  };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Formats a "YYYY-MM" string as "July 2026". */
function formatMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) return month;
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

/** Formats an ISO unlock timestamp as a compact, muted date (e.g. "Jul 2026"). */
function formatUnlockDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const monthShort = MONTH_NAMES[d.getUTCMonth()].slice(0, 3);
  return `${monthShort} ${d.getUTCFullYear()}`;
}

/** A small inline settings glyph (reuses GearIcon shape at 20px). */
function SettingsGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
