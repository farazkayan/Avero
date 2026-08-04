import { useEffect, useState } from "react";
import { Link } from "react-router";
import EmptyState from "../components/ui/EmptyState";
import PrimaryButton from "../components/ui/PrimaryButton";
import Spinner from "../components/ui/Spinner";
import { SparkleIcon } from "../components/ui/icons";
import SpaceCard from "../components/spaces/SpaceCard";
import { useAuth } from "../context/AuthContext";
import { fetchSpaceListThumbnailsBatch } from "../lib/media";
import { supabase } from "../lib/supabase";
import { SPACE_CREATE_PATH } from "../constants/routes";
import type { Media } from "../types/media";
import type { SpaceMembershipWithSpace } from "../types/space";

/**
 * Spaces Dashboard — the authenticated landing page (spaces-design §6.1).
 *
 * Replaces `SpacesPlaceholderPage`. Lists every Space the current user belongs
 * to, fetched on mount with plain `useEffect` + `supabase-js` — no React Query
 * (spaces-design §4.1, ai-context §4/§8). RLS auto-filters `space_members` to
 * the rows the viewer can see, so the query needs no extra access control.
 *
 * Three states, each calm and unambiguous (design-system §8):
 *  - Loading: a centered spinner while the first fetch is in flight.
 *  - Empty: an inspiring empty state (blueprint §6) that invites the user to
 *    create their first Space — never a bare "no spaces found".
 *  - List: a `SpaceCard` per membership, newest first.
 *
 * The "Create a Space" action is a visible placeholder: it links to
 * `SPACE_CREATE_PATH`, a route that does not exist yet. The create flow is a
 * later step in this phase (spaces-design §6.2).
 */
export default function SpacesDashboardPage() {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState<SpaceMembershipWithSpace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  // Per-Space thumbnail rows (first 1–2 media rows of each Space's most recent
  // Memory, oldest-first), batch-fetched in a single RPC round trip once the
  // memberships list is known. Keyed by space_id. A Space with no Memories /
  // no media maps to `[]` → the card renders no thumbnail (no placeholder, no
  // broken-image icon). Mirrors the Space timeline's thumbnails batch state.
  const [thumbnailsBySpaceId, setThumbnailsBySpaceId] = useState<
    Record<string, Media[]>
  >({});
  const [prevMemberships, setPrevMemberships] = useState(memberships);

  // When the memberships list becomes empty, clear stale thumbnails during
  // render instead of via an effect (react-hooks/set-state-in-effect). A
  // non-empty change is handled by the fetch effect below, which re-runs on
  // the new `memberships` reference.
  if (memberships !== prevMemberships) {
    setPrevMemberships(memberships);
    if (memberships.length === 0) {
      setThumbnailsBySpaceId({});
    }
  }

  useEffect(() => {
    if (!user) {
      // ProtectedRoute guarantees a user before this page mounts; this guard
      // only satisfies the type system. It must not call setState
      // synchronously (react-hooks/set-state-in-effect), and since the branch
      // is unreachable in practice, leaving the initial loading state is fine.
      return;
    }

    let cancelled = false;

    async function fetchSpaces(userId: string) {
      setIsLoading(true);
      setError(undefined);

      try {
        const { data, error: fetchError } = await supabase
          .from("space_members")
          .select("*, spaces(*)")
          .eq("user_id", userId)
          .order("joined_at", { ascending: false });

        if (cancelled) {
          return;
        }

        if (fetchError) {
          setError("We couldn't load your Spaces. Please try again.");
          return;
        }

        setMemberships((data ?? []) as SpaceMembershipWithSpace[]);
      } catch {
        if (cancelled) {
          return;
        }
        // Network failures and other unexpected thrown errors resolve to the
        // same calm, honest message (auth-design §7 voice).
        setError("We couldn't load your Spaces. Please try again.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchSpaces(user.id);

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Thumbnails batch — a single RPC round trip fetches the first 1–2 media
  // rows of each Space's most recent Memory (ordered by created_at), avoiding
  // N+1 per-card queries. Re-runs when the memberships list changes (no `user`
  // dep — RLS via JWT context in the RPC, same as the Space timeline's
  // thumbnails effect). A batch failure is calm: the map clears to `{}` and
  // the cards still render, just without thumbnails (mirrors the timeline's
  // "render the rest of the page" failure mode).
  useEffect(() => {
    if (memberships.length === 0) {
      return;
    }

    let cancelled = false;
    const spaceIds = memberships.map((m) => m.space_id);

    async function fetchThumbnails() {
      try {
        const result = await fetchSpaceListThumbnailsBatch(spaceIds);
        if (!cancelled) {
          setThumbnailsBySpaceId(result);
        }
      } catch {
        // Calm failure: clear the map so cards render without thumbnails
        // rather than crashing the dashboard. The Spaces themselves already
        // loaded; thumbnails are decorative, not primary content.
        if (!cancelled) {
          setThumbnailsBySpaceId({});
        }
      }
    }

    void fetchThumbnails();

    return () => {
      cancelled = true;
    };
  }, [memberships]);

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
          Your Spaces
        </h1>
        <Link
          to={SPACE_CREATE_PATH}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          Create a Space
        </Link>
      </div>

      {isLoading ? (
        <div
          className="flex items-center justify-center py-24 text-accent-400"
          role="status"
          aria-live="polite"
        >
          <Spinner size={28} />
        </div>
      ) : error ? (
        <div className="mt-10 rounded-xl border border-ink/5 bg-canvas-soft p-6 text-center">
          <p className="text-sm text-error">{error}</p>
        </div>
      ) : memberships.length === 0 ? (
        <EmptyState
          titleAs="h2"
          icon={<SparkleIcon />}
          title="Your first Space is where your shared story begins."
          description="Create a Space for the people you share memories with, or accept an invitation to join one."
        >
          <Link to={SPACE_CREATE_PATH}>
            <PrimaryButton type="button">Create a Space</PrimaryButton>
          </Link>
        </EmptyState>
      ) : (
        <ul className="mt-8 space-y-4">
          {memberships.map((membership) => (
            <li key={membership.id}>
              <SpaceCard
                space={membership.spaces}
                role={membership.role}
                thumbnails={thumbnailsBySpaceId[membership.spaces.id] ?? []}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
