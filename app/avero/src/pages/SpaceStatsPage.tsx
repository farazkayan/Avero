import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import GhostLink from "../components/ui/GhostLink";
import { AchievementIcon } from "../components/ui/icons";
import {
  fetchAchievementsWithState,
  fetchMemoryMonthHistogram,
  fetchSpaceStats,
  type MonthBucket,
} from "../lib/stats";
import { supabase } from "../lib/supabase";
import {
  spaceDetailPath,
  spaceSettingsPath,
} from "../constants/routes";
import type { AchievementWithState, SpaceStats } from "../types/stats";
import type { Space } from "../types/space";

/**
 * Space Statistics & Achievements - Redesigned to match Stitch HTML mockup
 * while using existing Avero functionality and data sources.
 */
export default function SpaceStatsPage() {
  const { spaceId } = useParams();

  const [space, setSpace] = useState<Space | null>(null);
  const [stats, setStats] = useState<SpaceStats | null>(null);
  const [achievements, setAchievements] = useState<AchievementWithState[]>([]);
  const [histogram, setHistogram] = useState<MonthBucket[]>([]);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;

    async function load(id: string) {
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
          return;
        }
        if (!spaceRes.data) {
          // RLS returned no rows — not a member or doesn't exist.
          return;
        }

        setSpace(spaceRes.data as Space);
        setStats(statsRow ?? emptyStats(id));
        setAchievements(ach);
        setHistogram(hist);
      } catch {
        return;
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
      {/* Page Container - matches Stitch structure */}
      <div className="min-h-screen flex flex-col pt-[72px] bg-[#fff8f5] dark:bg-[#121414] text-[#1e1b18] dark:text-[#e2e2e2] transition-colors duration-300">
        {/* Header - reuse exact same shared Header component via AppShell */}
        {/* AppShell provides the Header with logo, theme toggle, settings, user info */}
        
        {/* Main Content */}
        <main className="flex-grow max-w-[1280px] mx-auto w-full px-6 md:px-12 py-8 md:py-12 flex flex-col gap-12">
          {/* Page Header - Back link, Space name, Stats subtitle, Settings */}
          <div className="flex flex-col gap-4">
            <GhostLink to={spaceDetailPath(spaceId)} className="inline-flex items-center gap-2 text-on-surface-variant hover:text-accent-warm dark:text-[#8d8d8a] dark:hover:text-[#f7d6ac] transition-colors w-fit font-body-sm text-body-sm">
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Back to timeline
            </GhostLink>
            <div className="flex justify-between items-start">
              <div className="flex flex-col gap-1">
                <h1 className="font-headline-lg text-headline-lg text-on-surface dark:text-gray-100 break-words">
                  {space?.name}
                </h1>
                <p className="font-mono-data text-mono-data text-on-surface-variant dark:text-[#8d8d8a]">
                  {hasMemories
                    ? `${stats?.total_memories} memories · ${spaceAgeYears > 0 ? `${spaceAgeYears} year${spaceAgeYears === 1 ? "" : "s"}` : "less than a year"} together`
                    : "Your story starts here"}
                </p>
              </div>
              <Link to={spaceSettingsPath(spaceId)} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-low dark:hover:bg-[#1a1c1c] transition-colors duration-200 text-on-surface-variant dark:text-gray-300">
                <span className="material-symbols-outlined">settings</span>
              </Link>
            </div>
          </div>

          {/* The Story So Far (Stats Grid) */}
          <section className="flex flex-col gap-4">
            <h2 className="font-mono-label text-mono-label text-on-surface-variant dark:text-[#8d8d8a] tracking-wider uppercase">
              THE STORY SO FAR
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-[24px]">
              {/* Stat Card 1 (Memories) */}
<div className="bg-card-warm border border-outline-variant/50 rounded-xl p-6 flex flex-col items-center justify-center gap-1 hover:-translate-y-0.5 transition-transform duration-300 relative dark:bg-[#1a1c1c] dark:border-white/10">
  <span className="material-symbols-outlined absolute top-4 left-4 text-on-surface-variant/30 dark:text-white/20 text-[20px]">auto_awesome</span>
  <span className="font-headline-lg text-headline-lg text-accent-warm dark:text-[#f7d6ac] tabular-nums">{stats?.total_memories ?? 0}</span>
  <span className="font-body-sm text-body-sm text-on-surface-variant dark:text-[#8d8d8a]">Memories</span>
</div>
              {/* Stat Card 2 (Photos & videos) */}
<div className="bg-card-warm border border-outline-variant/50 rounded-xl p-6 flex flex-col items-center justify-center gap-1 hover:-translate-y-0.5 transition-transform duration-300 relative dark:bg-[#1a1c1c] dark:border-white/10">
  <span className="material-symbols-outlined absolute top-4 left-4 text-on-surface-variant/30 dark:text-white/20 text-[20px]">photo_library</span>
  <span className="font-headline-lg text-headline-lg text-accent-warm dark:text-[#f7d6ac] tabular-nums">{stats?.total_media ?? 0}</span>
  <span className="font-body-sm text-body-sm text-on-surface-variant dark:text-[#8d8d8a]">Photos & videos</span>
</div>
              {/* Stat Card 3 (Comments) */}
<div className="bg-card-warm border border-outline-variant/50 rounded-xl p-6 flex flex-col items-center justify-center gap-1 hover:-translate-y-0.5 duration-[300ms] relative dark:bg-[#1a1c1c] dark:border-white/10">
  <span className="material-symbols-outlined absolute top-4 left-4 text-on-surface-variant/30 dark:text-white/20 text-[20px]">chat_bubble</span>
  <span className="font-headline-lg text-headline-lg text-accent-warm dark:text-[#f7d6ac] tabular-nums">{stats?.total_comments ?? 0}</span>
  <span className="font-body-sm text-body-sm text-on-surface-variant dark:text-[#8d8d8a]">Comments</span>
</div>
              {/* Stat Card 4 (Reactions) */}
<div className="bg-card-warm border border-outline-variant/50 rounded-xl p-6 flex flex-col items-center justify-center gap-1 hover:-translate-y-0.5 duration-[300ms] relative dark:bg-[#1a1c1c] dark:border-white/10">
  <span className="material-symbols-outlined absolute top-4 left-4 text-on-surface-variant/30 dark:text-white/20 text-[20px]">favorite</span>
  <span className="font-headline-lg text-headline-lg text-accent-warm dark:text-[#f7d6ac] tabular-nums">{stats?.total_reactions ?? 0}</span>
  <span className="font-body-sm text-body-sm text-on-surface-variant dark:text-[#8d8d8a]">Reactions</span>
</div>
              {/* Stat Card 5 (Members) */}
<div className="bg-card-warm border border-outline-variant/50 rounded-xl p-6 flex flex-col items-center justify-center gap-1 hover:-translate-y-0.5 duration-[300ms] relative dark:bg-[#1a1c1c] dark:border-white/10">
  <span className="material-symbols-outlined absolute top-4 left-4 text-on-surface-variant/30 dark:text-white/20 text-[20px]">group</span>
  <span className="font-headline-lg text-headline-lg text-accent-warm dark:text-[#f7d6ac] tabular-nums">{stats?.member_count ?? 0}</span>
  <span className="font-body-sm text-body-sm text-on-surface-variant dark:text-[#8d8d8a]">Members</span>
</div>
              {/* Stat Card 6 (Days old) */}
<div className="bg-card-warm border border-outline-variant/50 rounded-xl p-6 flex flex-col items-center justify-center gap-1 hover:-translate-y-0.5 duration-[300ms] relative dark:bg-[#1a1c1c] dark:border-white/10">
  <span className="material-symbols-outlined absolute top-4 left-4 text-on-surface-variant/30 dark:text-white/20 text-[20px]">schedule</span>
  <span className="font-headline-lg text-headline-lg text-accent-warm dark:text-[#f7d6ac] tabular-nums">{stats?.space_age_days ?? 0}</span>
  <span className="font-body-sm text-body-sm text-on-surface-variant dark:text-[#8d8d8a]">Days old</span>
</div>
            </div>
          </section>

          {/* Memories Over Time (Chart) */}
          <section className="flex flex-col gap-4">
            <h2 className="font-mono-label text-mono-label text-on-surface-variant dark:text-[#8d8d8a] tracking-wider uppercase">
              MEMORIES OVER TIME
            </h2>
            <div className="bg-card-warm border border-outline-variant/50 rounded-xl p-6 md:p-8 card-shadow w-full dark:bg-[#1a1c1c] dark:border-white/10 hover-lift">
              <div className="w-full h-48 md:h-64 relative">
                {/* SVG Chart matching Stitch structure but with real data */}
                <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 1000 200">
                  <defs>
                    <linearGradient id="chart-gradient-light" x1="0%" x2="0%" y1="0%" y2="100%">
                      <stop offset="0%" stop-color="#9c7d52" stop-opacity="0.2"></stop>
                      <stop offset="100%" stop-color="#9c7d52" stop-opacity="0"></stop>
                    </linearGradient>
                    <linearGradient id="chart-gradient-dark" x1="0%" x2="0%" y1="0%" y2="100%">
                      <stop offset="0%" stop-color="#f7d6ac" stop-opacity="0.1"></stop>
                      <stop offset="100%" stop-color="#f7d6ac" stop-opacity="0"></stop>
                    </linearGradient>
                  </defs>
                  {/* Grid lines */}
                  {histogram.length > 0 && (
                    <>
                      <line className="chart-grid-line" x1="0" x2="1000" y1="50" y2="50"></line>
                      <line className="chart-grid-line" x1="0" x2="1000" y1="100" y2="100"></line>
                      <line className="chart-grid-line" x1="0" x2="1000" y1="150" y2="150"></line>
                    </>
                  )}
                  {/* Area Fill */}
                  {histogram.length > 0 && (
                    <>
                      <path
                        className="dark:hidden"
                        d={generateChartPath(histogram, 200, true)}
                        fill="url(#chart-gradient-light)"
                      ></path>
                      <path
                        className="hidden dark:block"
                        d={generateChartPath(histogram, 200, true)}
                        fill="url(#chart-gradient-dark)"
                      ></path>
                    </>
                  )}
                  {/* Data Line */}
                  {histogram.length > 0 && (
                    <>
                      <path
                        className="dark:hidden"
                        d={generateChartPath(histogram, 200, false)}
                        fill="none"
                        stroke="#9c7d52"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="3"
                      ></path>
                      <path
                        className="hidden dark:block"
                        d={generateChartPath(histogram, 200, false)}
                        fill="none"
                        stroke="#f7d6ac"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="3"
                      ></path>
                    </>
                  )}
                  {/* Data Points */}
                  {histogram.length > 0 && (
                    <>
                      <g className="dark:hidden">
                        {histogram.map((bucket, index) => {
                          const x = 100 + (index * (800 / Math.max(histogram.length - 1, 1)));
                          const y = 200 - (bucket.count * 180 / Math.max(...histogram.map(b => b.count), 1));
                          return (
                            <circle
                              key={index}
                              cx={x}
                              cy={y > 20 ? y : 20}
                              fill="#fff"
                              r="4"
                              stroke="#9c7d52"
                              stroke-width="2"
                            />
                          );
                        })}
                      </g>
                      <g className="hidden dark:block">
                        {histogram.map((bucket, index) => {
                          const x = 100 + (index * (800 / Math.max(histogram.length - 1, 1)));
                          const y = 200 - (bucket.count * 180 / Math.max(...histogram.map(b => b.count), 1));
                          return (
                            <circle
                              key={index}
                              cx={x}
                              cy={y > 20 ? y : 20}
                              fill="#1a1c1c"
                              r="4"
                              stroke="#f7d6ac"
                              stroke-width="2"
                            />
                          );
                        })}
                      </g>
                    </>
                  )}
                </svg>
              </div>
              <div className="flex justify-between items-center mt-4 font-mono-data text-mono-data text-on-surface-variant dark:text-[#8d8d8a]">
                {histogram.length > 0 && (
                  <>
                    <span>{formatMonth(histogram[0].month)}</span>
                    <span className="opacity-50 dark:opacity-40">
                      {formatMonth(histogram[Math.floor(histogram.length / 4)].month)}
                    </span>
                    <span className="opacity-50 dark:opacity-40">
                      {formatMonth(histogram[Math.floor(histogram.length / 2)].month)}
                    </span>
                    <span className="opacity-50 dark:opacity-40">
                      {formatMonth(histogram[Math.floor(histogram.length * 3 / 4)].month)}
                    </span>
                    <span>{formatMonth(histogram[histogram.length - 1].month)}</span>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* Summary Insights */}
          {stats && (
            <section className="flex flex-col gap-2 p-6 bg-surface-container-low rounded-xl border border-outline-variant/30 dark:bg-[#1a1c1c] dark:border-white/10">
              {stats.most_active_month && (
                <p className="font-body-md text-body-md text-on-surface-variant dark:text-gray-300">
                  Your most memory-filled month was{" "}
                  <span className="font-semibold text-accent-warm dark:text-[#f7d6ac]">
                    {formatMonth(stats.most_active_month)}
                  </span>
                  .
                </p>
              )}
              {stats.longest_gap_days !== null &&
                stats.longest_gap_days > 0 && (
                  <p className="font-body-md text-body-md text-on-surface-variant dark:text-gray-300">
                    The longest stretch between memories was{" "}
                    <span className="font-semibold text-accent-warm dark:text-[#f7d6ac]">
                      {stats.longest_gap_days} day{stats.longest_gap_days === 1 ? "" : "s"}
                    </span>
                    .
                  </p>
                )}
            </section>
          )}

          {/* Achievements */}
          <section className="flex flex-col gap-6">
            <div className="flex justify-between items-baseline border-b border-outline-variant/30 dark:border-white/10 pb-2">
              <h2 className="font-mono-label text-mono-label text-on-surface-variant dark:text-[#8d8d8a] tracking-wider uppercase">
                ACHIEVEMENTS
              </h2>
              <span className="font-mono-data text-mono-data text-on-surface-variant dark:text-[#8d8d8a]">
                {unlockedCount} / {achievements.length}
              </span>
            </div>
            <div className="flex flex-col gap-8">
              {/* MILESTONES */}
              <div className="flex flex-col gap-4">
                <h3 className="font-mono-label text-mono-label text-on-surface-variant dark:text-[#8d8d8a] tracking-wider">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-warm dark:bg-[#f7d6ac] mr-2 align-middle opacity-60"></span>
                  MILESTONES
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-[24px]">
                  {renderAchievementCards(achievements, "milestone")}
                </div>
              </div>
              {/* TIME */}
              <div className="flex flex-col gap-4">
                <h3 className="font-mono-label text-mono-label text-on-surface-variant dark:text-[#8d8d8a] tracking-wider">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#9c7d52] dark:bg-[#f7d6ac] mr-2 align-middle opacity-60"></span>
                  TIME
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {renderAchievementCards(achievements, "time")}
                </div>
              </div>
              {/* COLLABORATION */}
              <div className="flex flex-col gap-4">
                <h3 className="font-mono-label text-mono-label text-on-surface-variant dark:text-[#8d8d8a] tracking-wider">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#9c7d52] dark:bg-[#f7d6ac] mr-2 align-middle opacity-60"></span>
                  COLLABORATION
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {renderAchievementCards(achievements, "collaboration")}
                </div>
              </div>
              {/* VARIETY */}
              <div className="flex flex-col gap-4">
                <h3 className="font-mono-label text-mono-label text-on-surface-variant dark:text-[#8d8d8a] tracking-wider">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#9c7d52] dark:bg-[#f7d6ac] mr-2 align-middle opacity-60"></span>
                  VARIETY
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {renderAchievementCards(achievements, "variety")}
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

/**
 * Generate SVG path for chart based on histogram data
 */
function generateChartPath(
  buckets: MonthBucket[],
  height: number,
  isArea: boolean
): string {
  if (buckets.length === 0) return "M 0 200 L 1000 200";

  const maxCount = Math.max(...buckets.map(b => b.count));
  const points = buckets.map((bucket, index) => {
    const x = 100 + (index * (800 / Math.max(buckets.length - 1, 1)));
    const y = 200 - ((bucket.count / maxCount) * height);
    return `${x},${y > 20 ? y : 20}`;
  });

  if (isArea) {
    return `M 0 200 L ${points.join(" L ")} L 1000 200 Z`;
  } else {
    return `M ${points.join(" ")}`;
  }
}

/**
 * Render achievement cards for a specific category
 */
function renderAchievementCards(
  achievements: AchievementWithState[],
  category: string
) {
  const categoryAchievements = achievements.filter(a => a.category === category);
  return categoryAchievements.map((achievement) => {
    const unlocked = achievement.unlockedAt !== null;
    return (
<div
        key={achievement.id}
        className={
          "flex h-full flex-col rounded-xl border p-5 transition-colors duration-300 hover:-translate-y-1 duration-[300ms] " +
          (unlocked
            ? "border-accent-500/30 bg-card-warm"
            : "border-outline-variant/30 bg-surface-container-low opacity-80 border-dashed")
        }
      >
        <div
          className={
            "relative mb-3 flex h-12 w-12 items-center justify-center rounded-full " +
            (unlocked
              ? "bg-accent-soft text-accent-400"
              : "bg-outline-variant/5 text-on-surface-variant/30 grayscale")
          }
          aria-hidden="true"
        >
          {unlocked && (
            <>
              <div className="absolute inset-0 rounded-full bg-accent-500/20 blur-md dark:bg-accent-400/10" />
              <div className="absolute inset-0 rounded-full ring-2 ring-accent-500/20" />
            </>
          )}
          <AchievementIcon
            name={achievement.icon}
            className="relative z-10 h-6 w-6"
          />
        </div>
        <div className="font-headline-md text-headline-md text-on-surface">{achievement.title}</div>
        <div className="mt-1 font-mono-label text-mono-label text-on-surface-variant">
          {unlocked ? (
            <span>{formatUnlockDate(achievement.unlockedAt!)}</span>
          ) : (
            <span className="italic">Not yet</span>
          )}
        </div>
        {unlocked && (
          <div className="absolute top-3 right-3 text-accent-warm dark:text-[#f7d6ac]">
            <span className="material-symbols-outlined text-[18px] filled">stars</span>
          </div>
        )}
      </div>
    );
  });
}

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
