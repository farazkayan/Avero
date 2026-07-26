# Plan: Space List Card Redesign + Photo Preview

**Scope:** Redesign [`SpaceCard.tsx`](app/avero/src/components/spaces/SpaceCard.tsx) to the v2.0 design system and add a small photo preview (the most recent Memory's first 1–2 media rows) so Spaces feel alive on the "Your Spaces" list — mirroring the now-redesigned [`MemoryTimelineCard`](app/avero/src/components/memories/MemoryTimelineCard.tsx) / [`MemoryThumbnail`](app/avero/src/components/memories/MemoryThumbnail.tsx). **No** changes to `SpaceDetailPage.tsx`, `MemoryTimelineCard.tsx`, `MemoryThumbnail.tsx`, or any other already-redesigned surface. No new Space-level features beyond the visual redesign + thumbnail.

---

## 1. Key Decisions (flagged for confirmation)

### 1.1 Data fetching — NEW dedicated RPC (the existing `get_timeline_thumbnails` CANNOT be reasonably reused)

**Confirmed decision: a new RPC is warranted.** The existing [`get_timeline_thumbnails(p_memory_ids uuid[])`](supabase/migrations/20260723110000_get_timeline_thumbnails_rpc.sql) cannot be reasonably adapted/reused for "most recent Memory per Space." Reasoning:

- **Contract mismatch.** The existing RPC takes `p_memory_ids` — the caller already knows *which* Memories to fetch thumbnails for. The Spaces Dashboard has **no** Memory ids at all (it fetches `space_members` → `spaces` only). To reuse the existing RPC, the client would first have to resolve "the most recent Memory per Space," which is itself a per-group-latest query (`DISTINCT ON` / `ROW_NUMBER() PARTITION BY space_id ORDER BY memory_date DESC`). PostgREST has no native per-group `LIMIT`, so that step needs its own RPC. **Reuse = 2 round trips** (latest-memory RPC, then thumbnails RPC), which directly violates the spec's "as few round trips as possible."

- **Adapting the existing RPC breaks/overloads a shipped, out-of-scope surface.** The timeline (already redesigned, explicitly out of scope) calls `get_timeline_thumbnails` with Memory ids. Options to "adapt" it:
  - *Add an optional `p_space_ids` param and branch internally* → one function doing two jobs (fetch-by-memory-ids vs resolve-latest-then-fetch), dispatched by which arg is non-null. This muddies the security reasoning (the new branch adds a `memories` read + a second `ROW_NUMBER` partition) and couples two unrelated callers behind one name.
  - *Change the signature to Space ids only* → breaks the timeline caller. Not viable.

  Both options risk the already-redesigned timeline for no real benefit.

- **A new RPC does both steps in ONE round trip** and leaves the existing RPC untouched. It mirrors the existing RPC's *spirit* (per-group `LIMIT` via `ROW_NUMBER`, `SECURITY INVOKER`, RLS-gated, returns durable B2 keys — client presigns per thumbnail) with a single, clear purpose. This is the same judgment the timeline plan made in §1.1: the only faithful single-round-trip way to express a per-group limit is `ROW_NUMBER() OVER (PARTITION BY …)`.

**New RPC:** `get_space_list_thumbnails(p_space_ids uuid[])` — returns up to 2 media rows for the most recent Memory of each requested Space, tagged with `space_id` so the client groups by Space. See §3 Step 1.

### 1.2 "Most recent Memory" ordering — `memory_date DESC, created_at DESC` (matches the timeline)

The Space card thumbnail must be the same Memory the user sees first inside the Space, so "most recent" mirrors [`SpaceDetailPage`](app/avero/src/pages/SpaceDetailPage.tsx)'s timeline ordering: `memory_date DESC` (feature-specs §2). A `created_at DESC` tiebreaker makes the "same date" case deterministic (newer upload wins). This is the only sensible definition of "most recent" and keeps the list card and the timeline visually consistent.

### 1.3 Thumbnail component — REUSE `MemoryThumbnail` directly (do NOT reinvent)

The user explicitly said: "mirror the same visual language and thumbnail-fetching pattern, don't reinvent it." [`MemoryThumbnail`](app/avero/src/components/memories/MemoryThumbnail.tsx) already takes `media: Media[]` (1–2 rows, oldest-first) and renders the stack / peeking edge / video poster frame / "no media = no thumbnail" rule. The new RPC returns **exactly that shape** per Space (1–2 rows of the most recent Memory, oldest-first by `media.created_at ASC`). So `SpaceCard` renders `<MemoryThumbnail media={thumbnails} />` **directly** — zero new thumbnail component, zero reinvented logic. The thumbnail's internal presigned-URL resolution (`getMediaDownloadUrl` + `inFlight` ref) is caller-agnostic.

### 1.4 No new data displays — role badge is the only metadata today

The spec says: "Keep the existing member-count/memory-count info if already shown; if not currently shown, don't invent new data displays beyond what's specified here — just restyle what exists." [`SpaceCard`](app/avero/src/components/spaces/SpaceCard.tsx) currently shows **no** member count and **no** memory count — only the name, description, and role badge. **So no counts are added.** The card gains: the thumbnail + token restyle + `.hover-lift` + a mono role badge. That's it. (Adding counts would require a separate per-Space counts fetch and is explicitly out of scope.)

### 1.5 Role badge — keep the pill, switch its text to `font-mono`

The spec says: "Use `font-mono` for metadata (member count, memory count, 'Owner'/'Member' role badge **if styled as text**)." The current role badge is a pill (`bg-accent-soft text-accent-400` / `bg-white/5 text-ink-muted`), not bare text. **Judgment call:** keep the pill affordance (it's a recognizable role indicator) but switch its text to `font-mono` to honor the "mono-for-metadata" rule — the role label IS metadata. This matches the spirit of Design System §3 (mono reserved for metadata labels) without losing the pill. Flagged for confirmation.

### 1.6 Card stays a `<Link>` (no nested interactive elements)

[`MemoryTimelineCard`](app/avero/src/components/memories/MemoryTimelineCard.tsx) switched to a `<div>` + title-as-`<Link>` because it nests a reaction `<button>`. `SpaceCard` has **no** nested interactive element (the role badge is a `<span>`), so it **stays a `<Link>`** — simpler, whole-card click, exactly as today. `MemoryThumbnail` already renders its media with `pointer-events-none`, so thumbnail clicks pass through to the link rather than stealing it. No lightbox/click-to-enlarge from the card (mirrors the Memory card spec).

### 1.7 Media-web-optimizer follow-up — FLAGGED (out of scope, same as timeline plan)

The thumbnail still requests a **full-resolution** presigned GET URL for a ~56–72px square. The proper fix is a thumbnail/small-size image variant generated at upload time (the existing "media web optimizer" TODO). **Out of scope here**; the per-Space `LIMIT 2` is the only bandwidth mitigation available without the optimizer. Same flag as [`plans/memory-timeline-card-redesign.md`](plans/memory-timeline-card-redesign.md) §1.4.

---

## 2. Architecture Overview

```mermaid
flowchart TD
    subgraph Page["SpacesDashboardPage.tsx - page-owned batch state"]
        Mem[memberships + spaces] --> SpaceIds[spaceIds derived]
        SpaceIds --> TnEff[thumbnails batch effect - NEW]
        TnEff --> TnMap[thumbnailsBySpaceId map - durable keys]
    end

    subgraph RPC["Supabase - NEW read-only RPC"]
        TnEff -->|rpc get_space_list_thumbnails space_ids| Fn[ROW_NUMBER PARTITION BY space_id latest memory LIMIT 2 media]
        Fn -->|SECURITY INVOKER + memories_select + media_select RLS| Rows[first 1-2 media rows of most recent memory per space]
    end

    subgraph Card["SpaceCard.tsx - token-driven redesign"]
        TnMap --> Card
        Card --> Thumb[MemoryThumbnail - REUSED as-is]
        Thumb -->|per-id effect + inFlight ref| Presign[getMediaDownloadUrl - existing]
        Presign -->|presigned GET| Img[img or video poster frame]
    end
```

---

## 3. Detailed Steps

### Step 1 — Migration: `get_space_list_thumbnails` RPC (NEW)

**File:** `supabase/migrations/20260724110000_get_space_list_thumbnails_rpc.sql` (new)

A read-only `SECURITY INVOKER` function returning up to 2 media rows for the **most recent Memory** of each requested Space, oldest-first (matches the gallery's `created_at ASC` reading order, same as the existing timeline RPC). Two CTEs, one round trip:

```sql
CREATE OR REPLACE FUNCTION get_space_list_thumbnails(p_space_ids uuid[])
RETURNS TABLE (
    space_id     uuid,
    id           uuid,
    memory_id    uuid,
    url          text,
    storage_path text,
    type         text,
    created_at   timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    -- Authentication guard. The real authorization gate is memories_select +
    -- media_select RLS (is_space_member via the parent memory's space), which
    -- filter the returned rows under SECURITY INVOKER. This guard just gives a
    -- clear error for an unauthenticated call rather than an empty result.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'get_space_list_thumbnails: authentication required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Empty input short-circuits to no rows (the client also guards this, but
    -- the function is defensive). ANY(uuid[]) on an empty array returns no
    -- rows, so this is belt-and-braces.
    RETURN QUERY
    WITH latest_memory AS (
        -- The single most recent Memory per Space, mirroring the timeline's
        -- ordering (memory_date DESC, created_at DESC tiebreaker). RLS on
        -- `memories` (memories_select: is_space_member OR created_by = auth.uid,
        -- AND deleted_at IS NULL) auto-filters here under SECURITY INVOKER, so
        -- a non-member gets no rows and soft-deleted Memories are excluded.
        SELECT lm.space_id, lm.memory_id
        FROM (
            SELECT
                memories.space_id,
                memories.id AS memory_id,
                ROW_NUMBER() OVER (
                    PARTITION BY memories.space_id
                    ORDER BY memories.memory_date DESC, memories.created_at DESC
                ) AS rn
            FROM memories
            WHERE memories.space_id = ANY(p_space_ids)
        ) lm
        WHERE lm.rn = 1
    ),
    top_media AS (
        -- The first 1-2 media rows of that one Memory, oldest-first (matches
        -- the gallery's reading order, same as get_timeline_thumbnails). RLS on
        -- `media` (media_select: is_space_member via the parent memory's space)
        -- auto-filters here too.
        SELECT
            latest_memory.space_id,
            media.id,
            media.memory_id,
            media.url,
            media.storage_path,
            media.type,
            media.created_at,
            ROW_NUMBER() OVER (
                PARTITION BY latest_memory.space_id
                ORDER BY media.created_at ASC
            ) AS mrn
        FROM latest_memory
        JOIN media ON media.memory_id = latest_memory.memory_id
    )
    SELECT space_id, id, memory_id, url, storage_path, type, created_at
    FROM top_media
    WHERE mrn <= 2;
END;
$$;

REVOKE ALL ON FUNCTION get_space_list_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_space_list_thumbnails(uuid[]) TO authenticated;
```

Notes:
- `SECURITY INVOKER` → `memories_select` and `media_select` RLS filter exactly as plain selects would. A non-member gets zero rows for that Space (calm, same as the timeline RPC). `SECURITY DEFINER` would be wrong (it bypasses RLS; only needed when the function must read tables the caller can't, e.g. `is_space_member` itself).
- `ROW_NUMBER() PARTITION BY space_id` is the standard per-group-limit pattern; `rn = 1` selects the most recent Memory, then `mrn <= 2` selects the first 2 media rows of it.
- Returns durable B2 keys (`url`/`storage_path`), **not** presigned URLs — presigning happens client-side per thumbnail (Step 3), mirroring `MediaGallery` / the timeline thumbnail.
- `SET search_path = public` — standard hardening (matches `is_space_member` / `sync_memory_tags` / `get_timeline_thumbnails`).
- The `memories_select` policy's `created_by = auth.uid()` clause means a Memory the caller authored in a Space they've since left could still surface. The Dashboard only lists Spaces the user is a *member* of, so this is a non-issue in practice (a left Space isn't in the list).

### Step 2 — `lib/media.ts`: add `fetchSpaceListThumbnailsBatch`

**File:** [`app/avero/src/lib/media.ts`](app/avero/src/lib/media.ts) (edit)

A batch helper mirroring [`fetchTimelineThumbnailsBatch`](app/avero/src/lib/media.ts)'s shape, but keyed by `space_id` (the new RPC returns `space_id`). Takes `spaceIds`, returns `Record<string, Media[]>` (each Space → its 1–2 thumbnail rows, oldest-first). Seeds every requested id with `[]` so the result is total (a Space with no Memories / no media maps to `[]` → card renders no thumbnail, no special-case branch). Empty input returns `{}` without a round trip. Throws on error; the page handles it calmly (cards render without thumbnails).

```ts
export async function fetchSpaceListThumbnailsBatch(
  spaceIds: string[],
): Promise<Record<string, Media[]>> {
  // Seed every requested Space with an empty array so the result is total.
  const map: Record<string, Media[]> = {};
  for (const id of spaceIds) {
    map[id] = [];
  }

  if (spaceIds.length === 0) {
    return map;
  }

  const { data, error } = await supabase.rpc("get_space_list_thumbnails", {
    p_space_ids: spaceIds,
  });

  if (error) {
    throw error;
  }

  for (const row of (data ?? []) as (Media & { space_id: string })[]) {
    // Drop rows whose type is neither image nor video (defensive, mirrors
    // MediaGallery + fetchTimelineThumbnailsBatch).
    if (asMediaType(row.type) === null) {
      continue;
    }
    const bucket = map[row.space_id];
    if (bucket) {
      bucket.push(row);
    }
  }

  return map;
}
```

### Step 3 — `SpacesDashboardPage.tsx`: thumbnails state + batch effect

**File:** [`app/avero/src/pages/SpacesDashboardPage.tsx`](app/avero/src/pages/SpacesDashboardPage.tsx) (edit)

- New state: `thumbnailsBySpaceId: Record<string, Media[]>` (init `{}`).
- New effect, **separate** from the memberships fetch, depends on `[memberships]` (derive `spaceIds` inside): calls `fetchSpaceListThumbnailsBatch(memberships.map(m => m.space_id))`, sets the map on success, clears to `{}` on calm failure. Mirrors the existing `cancelled` guard and "render the rest of the page" failure mode used by [`SpaceDetailPage`](app/avero/src/pages/SpaceDetailPage.tsx)'s thumbnails effect. No `user` dep (RLS via JWT context in the RPC, same as the timeline thumbnails effect).
- Pass `thumbnails={thumbnailsBySpaceId[membership.spaces.id] ?? []}` into `SpaceCard`.

### Step 4 — `SpaceCard.tsx`: token-driven redesign + reuse `MemoryThumbnail`

**File:** [`app/avero/src/components/spaces/SpaceCard.tsx`](app/avero/src/components/spaces/SpaceCard.tsx) (edit)

Props: add `thumbnails: Media[]` (the 1–2 rows for this Space, oldest-first; `[]` → no thumbnail).

Visual redesign (all from v2.0 tokens — no one-off values), mirroring [`MemoryTimelineCard`](app/avero/src/components/memories/MemoryTimelineCard.tsx):
- **Card surface:** `bg-canvas-soft` + `border border-white/5` + `rounded-xl` (already mostly there).
- **Hover:** REPLACE the ad-hoc `transition-colors duration-200 hover:border-white/10 hover:bg-canvas-raised` with the canonical `.hover-lift` class (translateY, accent border, one hairline glow — the only place accent glow is applied on hover per Design System §7). Keep `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60`.
- **Layout:** flex row — text content in a `min-w-0 flex-1` column (title + role badge row, then description), thumbnail top-right with `shrink-0` as the last child. Mirrors `MemoryTimelineCard`'s `flex items-start gap-4` + `min-w-0 flex-1` + thumbnail-as-last-child.
- **Title:** `text-base font-semibold text-ink` (sans-serif, primary) — unchanged.
- **Role badge:** keep the pill (`bg-accent-soft text-accent-400` for Owner / `bg-white/5 text-ink-muted` for Member) but switch text to `font-mono` (Decision §1.5).
- **Description:** `text-sm text-ink-muted line-clamp-2` (sans) — unchanged.
- **Thumbnail:** `<MemoryThumbnail media={thumbnails} />` top-right, ~64px, `rounded-lg`, hairline border — all handled by the reused component. Renders nothing when `thumbnails` is `[]` (no placeholder, no broken-image icon — spec).
- **Navigation:** the card stays a `<Link>` (Decision §1.6 — no nested interactive elements). `MemoryThumbnail`'s media is `pointer-events-none`, so clicks pass through to the link.

Sketch (final markup shape):

```tsx
<Link
  to={spaceDetailPath(space.id)}
  className="hover-lift block rounded-xl border border-white/5 bg-canvas-soft p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
>
  <div className="flex items-start gap-4">
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-base font-semibold text-ink">{space.name}</h3>
        <RoleBadge role={role} />
      </div>
      {space.description && (
        <p className="mt-2 line-clamp-2 text-sm text-ink-muted">
          {space.description}
        </p>
      )}
    </div>
    <MemoryThumbnail media={thumbnails} />
  </div>
</Link>
```

### Step 5 — Verify

- **Visual:** card uses `canvas-soft` + hairline + `.hover-lift` glow; role badge in mono; thumbnail top-right with restrained stacked effect for 2 photos; video poster frame for video-first.
- **Data:** one RPC round trip for all Space thumbnails; only 1–2 rows per Space (of the most recent Memory); presigned URLs resolved per-thumbnail (≤2 per card); no full-photo fetch.
- **Empty/no-media:** a Space with no Memories / no media renders no thumbnail, no placeholder, no broken icon.
- **Navigation:** card click → Space Detail; thumbnail click does nothing special (no lightbox).
- **RLS:** non-member gets no thumbnail rows (RPC is INVOKER + `memories_select`/`media_select` RLS); cards render without thumbnails, calmly.
- **Reduced motion:** `.hover-lift` respects the global `prefers-reduced-motion` rule already in [`index.css`](app/avero/src/index.css).
- **Out of scope respected:** `SpaceDetailPage.tsx`, `MemoryTimelineCard.tsx`, `MemoryThumbnail.tsx` internals all untouched; no new Space-level features.

---

## 4. Files Touched

| File | Action |
|------|--------|
| `supabase/migrations/20260724110000_get_space_list_thumbnails_rpc.sql` | New — read-only `SECURITY INVOKER` RPC (most-recent-Memory-per-Space, then per-Space `LIMIT 2` media) |
| [`app/avero/src/lib/media.ts`](app/avero/src/lib/media.ts) | Edit — add `fetchSpaceListThumbnailsBatch` |
| [`app/avero/src/pages/SpacesDashboardPage.tsx`](app/avero/src/pages/SpacesDashboardPage.tsx) | Edit — thumbnails state + batch effect; pass `thumbnails` to `SpaceCard` |
| [`app/avero/src/components/spaces/SpaceCard.tsx`](app/avero/src/components/spaces/SpaceCard.tsx) | Edit — token restyle + `.hover-lift` + flex layout + mono role badge + reuse `<MemoryThumbnail>` |

## 5. Out of Scope (explicit)

- `SpaceDetailPage.tsx` — untouched.
- `MemoryTimelineCard.tsx`, `MemoryThumbnail.tsx` — reused as-is, not modified.
- Member-count / memory-count displays on the Space card — not added (none exist today; spec forbids inventing new data displays).
- Media web optimizer / thumbnail-size variant at upload — flagged follow-up, not built here.
- Realtime updates — refresh-based, same as the rest of the app.
