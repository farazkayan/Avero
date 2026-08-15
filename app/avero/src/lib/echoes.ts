import { supabase } from "./supabase";
import type { Memory } from "../types/memory";

/**
 * Echoes ("On This Day") utilities.
 *
 * Pure date arithmetic — no AI, no external calls. Computes the qualifying
 * dates for "today" across previous intervals (1 week, 1 month, 1 year, N years).
 * All logic uses the user's local calendar date (not UTC/server time) so a user
 * sees Echoes for their actual today, regardless of timezone offset.
 *
 * Follows the "passive-only" rule (Spec §1): no notifications, no badges,
 * no catch-up, no persistence. If the user doesn't open the app on a day with
 * matches, they simply never see those Echoes.
 */

/** Returns today's date as a "YYYY-MM-DD" string in the user's local timezone. */
export function getTodayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Clamps a day to the last valid day of a given month/year.
 * e.g., clampDayToMonth(2026, 1, 31) → 28 (Feb 2026 has 28 days)
 * e.g., clampDayToMonth(2024, 1, 31) → 29 (Feb 2024 is a leap year)
 */
export function clampDayToMonth(year: number, month: number, day: number): number {
  // month is 0-indexed (0 = Jan, 1 = Feb, ...)
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  return Math.min(day, lastDayOfMonth);
}

/**
 * Subtracts N months from a date, clamping the day if the target month is shorter.
 * e.g., 2026-03-31 minus 1 month → 2026-02-28 (not 2026-02-31 which doesn't exist)
 */
export function subtractMonths(date: Date, months: number): Date {
  const year = date.getFullYear();
  const month = date.getMonth() - months;
  const day = date.getDate();

  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12; // normalize to 0-11
  const clampedDay = clampDayToMonth(targetYear, targetMonth, day);

  return new Date(targetYear, targetMonth, clampedDay);
}

/**
 * Subtracts N years from a date, clamping Feb 29 to Feb 28 in non-leap years.
 * e.g., 2024-02-29 minus 1 year → 2023-02-28
 * e.g., 2024-02-29 minus 4 years → 2020-02-29 (leap year preserved)
 */
export function subtractYears(date: Date, years: number): Date {
  const year = date.getFullYear() - years;
  const month = date.getMonth();
  const day = date.getDate();

  const clampedDay = clampDayToMonth(year, month, day);
  return new Date(year, month, clampedDay);
}

/**
 * Formats a Date as "YYYY-MM-DD" in local timezone.
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Computes all qualifying target dates for Echoes intervals for a given "today".
 *
 * Intervals (Spec §2):
 * - Exactly 1 week ago (7 days)
 * - Exactly 1 month ago (same day-of-month, previous month — clamped)
 * - Exactly 1 year ago (same month/day, previous year — clamped for Feb 29)
 * - Exactly N years ago for any N ≥ 2 where a Memory exists (dynamically checked via query)
 *
 * The "N years ago" interval is NOT precomputed here — we compute 1 week, 1 month, 1 year,
 * and then the query will naturally return any memories matching those month/day combinations
 * for earlier years. The interval label is computed per-memory based on the actual year difference.
 *
 * @returns Array of "YYYY-MM-DD" date strings to query for.
 */
export function computeEchoesTargetDates(today: string): string[] {
  const todayDate = new Date(`${today}T00:00:00`); // parse as local date
  const targets = new Set<string>();

  // 1 week ago
  const oneWeekAgo = new Date(todayDate);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  targets.add(formatLocalDate(oneWeekAgo));

  // 1 month ago (clamped)
  const oneMonthAgo = subtractMonths(todayDate, 1);
  targets.add(formatLocalDate(oneMonthAgo));

  // 1 year ago (clamped for Feb 29)
  const oneYearAgo = subtractYears(todayDate, 1);
  targets.add(formatLocalDate(oneYearAgo));

  // Note: N years ago (N >= 2) are NOT added here as specific dates.
  // Instead, the query uses the month/day from today and finds ANY year
  // where a memory exists. The interval label is computed per-memory.
  // This is handled in getIntervalLabel() by comparing the memory's year to today's year.

  return Array.from(targets);
}

/**
 * Computes the human-readable interval label for a memory date relative to today.
 * Examples: "1 week ago", "1 month ago", "1 year ago", "3 years ago", "10 years ago"
 */
export function getIntervalLabel(memoryDate: string, today: string): string {
  const memDate = new Date(`${memoryDate}T00:00:00`);
  const todayDate = new Date(`${today}T00:00:00`);

  const memYear = memDate.getFullYear();
  const memMonth = memDate.getMonth();
  const memDay = memDate.getDate();

  const todayYear = todayDate.getFullYear();
  const todayMonth = todayDate.getMonth();
  const todayDay = todayDate.getDate();

  const yearDiff = todayYear - memYear;

  // Same month and day → year-based interval
  if (memMonth === todayMonth && memDay === todayDay) {
    if (yearDiff === 1) return "1 year ago";
    if (yearDiff >= 2) return `${yearDiff} years ago`;
  }

  // 1 month ago (month diff = 1, same day, year same or previous)
  // We check if the memory date matches the "1 month ago" computed target
  const oneMonthAgoTarget = subtractMonths(todayDate, 1);
  if (
    memDate.getFullYear() === oneMonthAgoTarget.getFullYear() &&
    memDate.getMonth() === oneMonthAgoTarget.getMonth() &&
    memDate.getDate() === oneMonthAgoTarget.getDate()
  ) {
    return "1 month ago";
  }

  // 1 week ago (exactly 7 days)
  const oneWeekAgoTarget = new Date(todayDate);
  oneWeekAgoTarget.setDate(oneWeekAgoTarget.getDate() - 7);
  if (
    memDate.getFullYear() === oneWeekAgoTarget.getFullYear() &&
    memDate.getMonth() === oneWeekAgoTarget.getMonth() &&
    memDate.getDate() === oneWeekAgoTarget.getDate()
  ) {
    return "1 week ago";
  }

  // Fallback (shouldn't happen if query is correct, but safe)
  if (yearDiff === 1) return "1 year ago";
  if (yearDiff >= 2) return `${yearDiff} years ago`;
  return "Earlier";
}

/**
 * Fetches all Memories in a Space that match any of the Echoes target dates for today.
 * Single query using the existing partial index (idx_memories_space_date_active).
 * Excludes soft-deleted memories (deleted_at IS NULL) — RLS also filters these.
 *
 * @param spaceId The Space to search within
 * @param targetDates Array of "YYYY-MM-DD" strings from computeEchoesTargetDates()
 * @returns Array of matching Memories (may be empty)
 */
export async function fetchEchoesMemories(
  spaceId: string,
  targetDates: string[]
): Promise<Memory[]> {
  if (targetDates.length === 0) return [];

  const { data, error } = await supabase
    .from("memories")
    .select("*")
    .eq("space_id", spaceId)
    .in("memory_date", targetDates)
    .is("deleted_at", null);

  if (error) {
    throw error;
  }

  return (data as Memory[]) ?? [];
}