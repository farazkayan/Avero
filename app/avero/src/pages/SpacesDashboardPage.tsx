import { useEffect, useState } from "react";
import { Link } from "react-router";
import EmptyState from "../components/ui/EmptyState";
import PrimaryButton from "../components/ui/PrimaryButton";
import FlowButton from "../components/ui/flow-button";
import Spinner from "../components/ui/Spinner";
import { SparkleIcon } from "../components/ui/icons";
import SpaceCard from "../components/spaces/SpaceCard";
import { useAuth } from "../context/AuthContext";
import { fetchSpaceMosaicThumbnailsBatch } from "../lib/media";
import { supabase } from "../lib/supabase";
import { SPACE_CREATE_PATH } from "../constants/routes";
import type { Media } from "../types/media";
import type { SpaceMembershipWithSpace, SpaceMemberProfile } from "../types/space";

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
  // Per-Space members (including profile avatars) for the avatar stack.
  const [membersBySpaceId, setMembersBySpaceId] = useState<
    Record<string, (SpaceMembershipWithSpace & { profiles: SpaceMemberProfile })[]>
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
      setMembersBySpaceId({});
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
        // Step 1: Fetch memberships with spaces. The dependent data
        // (stats, members, thumbnails) is fetched in parallel inside a
        // separate effect (M-23 — was previously chained here, stretching
        // the dashboard's first paint).
        const { data: membershipsData, error: fetchError } = await supabase
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

        const memberships = (membershipsData ?? []) as SpaceMembershipWithSpace[];
        setMemberships(memberships);
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
    };

    void fetchSpaces(user.id);

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Fetch dependent data (stats, members, thumbnails) for the current set of
  // memberships in parallel. Replaces the previous design where these were
  // serialized across three effects (M-23 — sequential round-trips stretched
  // the dashboard's first paint by ~3×).
  useEffect(() => {
    if (memberships.length === 0) {
      return;
    }

    const spaceIds = memberships.map((m) => m.space_id);
    if (spaceIds.length === 0) return;

    let cancelled = false;

    async function fetchAll() {
      try {
        // Members + stats + thumbnails fetch in parallel — three independent
        // round trips rather than three sequential ones.
        const [membersRes, statsRes, thumbnailsResult] = await Promise.all([
          supabase
            .from("space_members")
            .select("*, profiles!space_members_user_id_fkey(avatar_url, name)")
            .in("space_id", spaceIds),
          supabase
            .from("space_stats_cache")
            .select("space_id, total_memories")
            .in("space_id", spaceIds),
          fetchSpaceMosaicThumbnailsBatch(spaceIds).catch(
            () => ({}) as Record<string, Media[]>,
          ),
        ]);

        if (cancelled) return;

        // Members — group by space_id
        if (!membersRes.error && membersRes.data) {
          const grouped: Record<string, (SpaceMembershipWithSpace & { profiles: SpaceMemberProfile })[]> = {};
          (membersRes.data as unknown as Array<SpaceMembershipWithSpace & { profiles: SpaceMemberProfile }>).forEach(
            (member) => {
              const id = member.space_id;
              if (!grouped[id]) {
                grouped[id] = [];
              }
              grouped[id].push(member);
            },
          );
          setMembersBySpaceId(grouped);
        } else {
          // Calm failure: the cards still render, just without avatars.
          console.error("Members fetch failed:", membersRes.error);
          setMembersBySpaceId({});
        }

        // Stats — fold into the existing memberships so SpaceCard sees the
        // memory count.
        if (!statsRes.error && statsRes.data) {
          const statsMap = new Map(
            (statsRes.data as Array<{ space_id: string; total_memories: number }>).map(
              (s) => [s.space_id, s.total_memories] as const,
            ),
          );
          setMemberships((prev) =>
            prev.map((m) => ({
              ...m,
              spaces: {
                ...m.spaces,
                space_stats_cache: [
                  { total_memories: statsMap.get(m.spaces.id) ?? 0 },
                ],
              },
            })),
          );
        }

        // Thumbnails
        setThumbnailsBySpaceId(thumbnailsResult);
      } catch {
        if (!cancelled) {
          setThumbnailsBySpaceId({});
          setMembersBySpaceId({});
        }
      }
    }

    void fetchAll();

    return () => {
      cancelled = true;
    };
  }, [memberships]);

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface dark:text-surface-container-lowest mb-2">
            Your Spaces
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant dark:text-secondary-fixed-dim">
            Shared albums and collaborative memory vaults.
          </p>
        </div>
        <FlowButton
          to={SPACE_CREATE_PATH}
          text="Create a Space"
        />
      </div>

      {isLoading ? (
        <div
          className="flex items-center justify-center py-24 text-accent-warm dark:text-primary-fixed-dim"
          role="status"
          aria-live="polite"
        >
          <Spinner size={28} />
        </div>
      ) : error ? (
        <div className="mt-10 rounded-xl border border-outline-variant dark:border-outline bg-surface-container-low dark:bg-card-dark p-6 text-center">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {memberships.map((membership) => {
            const space = membership.spaces;
            const stats = space.space_stats_cache?.[0];
            const memoryCount = stats?.total_memories ?? 0;
            return (
              <div key={membership.id}>
                <SpaceCard
                  space={space}
                  role={membership.role}
                  thumbnails={thumbnailsBySpaceId[space.id] ?? []}
                  members={membersBySpaceId[space.id] ?? []}
                  memoryCount={memoryCount}
                />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
