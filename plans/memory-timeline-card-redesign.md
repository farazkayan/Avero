# Plan: Memory Timeline Card Redesign + Photo Thumbnail

**Scope:** Redesign the Memory card on [`SpaceDetailPage.tsx`](app/avero/src/pages/SpaceDetailPage.tsx) to the v2.0 design system (deliberate token usage, not inherited), and add the deferred photo-thumbnail feature. **No** changes to Memory Detail gallery, SpaceCard, or reaction pill interaction logic.

---

## 1. Key Decisions (flagged for confirmation)

### 1.1 Data fetching — RPC with per-group LIMIT (deviation from the literal `.in()` pattern, same spirit)

The spec says "mirror the batching approach used in `fetchMemoryReactionsBatch`." That helper uses a flat `select(...).in("memory_id", ids)` — one round trip, client-side grouping. **But** the thumbnail requirement adds a constraint reactions didn't have: *fetch only the first 1–2 media rows per Memory, ordered by `created_at`*. PostgREST has no native per-group `LIMIT` on a flat `.in()` query — a plain `.in("memory_id", ids)` returns **all** media for all those Memories, which directly violates "do not fetch full presigned URLs for every photo of every Memory."

**Decision:** Add a small read-only RPC, `get_timeline_thumbnails(p_memory_ids uuid[])`, that returns the first 2 media rows per Memory via `ROW_NUMBER() OVER (PARTITION BY memory_id ORDER BY created_at)`. This is the only faithful way to get a per-group limit in a single round trip.

- **Why not fetch-all + trim client-side:** violates the explicit "don't fetch every photo" constraint; a Memory with 50 photos would pull 50 rows + 50 presigned URL requests.
- **Why not N queries (one per Memory):** violates "as few round trips as possible"; reintroduces the N+1 the reactions batch was built to kill.
- **Why RPC is consistent with the codebase:** `sync_memory_tags` and `get_invitation_by_token` already establish the RPC pattern (SECURITY DEFINER, `SET search_path = public`, explicit auth check). The thumbnail RPC follows the same shape.
- **Security:** `SECURITY INVOKER` (not DEFINER) so `media_select` RLS (`is_space_member` via the parent memory's space) filters rows exactly as a plain `select` would — **no RLS bypass**. This is the correct choice for a read-only helper; DEFINER would be wrong here (it's only needed when the function must read tables the caller can't, e.g. `is_space_member` itself). An explicit `is_space_member` guard is still added up front for a clear error, but the real gate is RLS on the returned rows.

**This honors the *spirit* of `fetchMemoryReactionsBatch`** (one batch round trip, client-side grouping into a per-Memory map, calm failure, page-owned state) while using the only mechanism that can express the per-group limit. The deviation is the query shape (RPC vs `.in()`), not the batching philosophy.

### 1.2 Same effect vs separate effect — SEPARATE

The reactions batch effect depends on `[memories, user]` (needs `currentUserId`); the thumbnails batch depends on `[memories]` only (RLS via JWT context in the RPC, no `user` needed). Combining them would couple two independent failure modes — a thumbnail RPC failure would also wipe reactions, or vice versa — and force the dep array to the union. **Keeping them separate** matches the existing reactions effect's shape, lets each fail calmly and independently (cards render without counts; cards render without thumbnails), and both fire on the same `memories` change so they run in the same tick (no extra perceived latency).

### 1.3 Date format — `DD Mon YYYY` in `font-mono` (CONFIRMED)

**Confirmed:** `23 Jul 2026` (DD Mon YYYY, short month, `font-mono`).

Current: `toLocaleDateString(undefined, { year: numeric, month: long, day: numeric })` → "July 23, 2026" (sans-serif). Design system §3 reserves `font-mono` for "dates, counts, stat numbers, and metadata labels," so the date row moves to mono regardless.

Why this format over the alternatives:
- `DD.MM.YYYY` (concept-mockup style) is journal-stamp-like but **locale-ambiguous** (03.04 = Mar 4 or Apr 3) — rejected for the ambiguity.
- Long-form "July 23, 2026" in mono looks clunky — long month names render awkwardly in a monospace face.
- **`23 Jul 2026`** is compact, unambiguous, and still reads as a quiet journal stamp that pairs with the brass/album aesthetic. Confirmed by the user.

Implementation: format via `date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })` and apply `font-mono` on the metadata row. Location (if present) joins the same mono row.

### 1.4 Media-web-optimizer follow-up — FLAGGED (out of scope)

The thumbnail still requests a **full-resolution** presigned GET URL (the same `getMediaDownloadUrl` the gallery uses) for a ~56–72px square. This is wasteful for a timeline of N cards. The proper fix is a thumbnail/small-size image variant generated at upload time (the existing "media web optimizer" TODO). **That is explicitly out of scope here** per the spec; this plan reuses the existing download path and flags the follow-up. The per-group LIMIT (1–2 rows) is the only bandwidth mitigation available without the optimizer.

---

## 2. Architecture Overview

```mermaid
flowchart TD
    subgraph Page["SpaceDetailPage.tsx - page-owned batch state"]
        Mem[memories list] --> RxEff[reactions batch effect - existing]
        Mem --> TnEff[thumbnails batch effect - NEW]
        RxEff --> RxMap[reactionsByMemoryId map]
        TnEff --> TnMap[thumbnailsByMemoryId map - durable keys]
    end

    subgraph RPC["Supabase - new read-only RPC"]
        TnEff -->|rpc get_timeline_thumbnails ids| Fn[ROW_NUMBER PARTITION BY memory_id LIMIT 2]
        Fn -->|SECURITY INVOKER + media_select RLS| Rows[first 1-2 media rows per memory]
    end

    subgraph Card["MemoryTimelineCard.tsx - NEW component"]
        RxMap --> Card
        TnMap --> Card
        Card --> Thumb[MemoryThumbnail - NEW]
        Thumb -->|per-id effect + inFlight ref| Presign[getMediaDownloadUrl - existing]
        Presign -->|presigned GET| Img[img or video poster frame]
    end

    subgraph Reuse["Reused as-is"]
        Card --> Rx[TimelineReactionControl - visual tokens only]
    end
```

---

## 3. Detailed Steps

### Step 1 — Migration: `get_timeline_thumbnails` RPC

**File:** `supabase/migrations/20260723110000_get_timeline_thumbnails_rpc.sql` (new)

A read-only `SECURITY INVOKER` function returning up to 2 media rows per requested Memory, oldest-first (matches the gallery's `created_at ASC` reading order, so "first by created_at" = first added).

```sql
CREATE OR REPLACE FUNCTION get_timeline_thumbnails(p_memory_ids uuid[])
RETURNS TABLE (
    id uuid,
    memory_id uuid,
    url text,
    storage_path text,
    type text,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    -- Authorization is enforced by media_select RLS (is_space_member via the
    -- parent memory's space) because this is SECURITY INVOKER. The explicit
    -- guard gives a clear error if called unauthenticated; RLS is the real gate.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'get_timeline_thumbnails: authentication required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    SELECT m.id, m.memory_id, m.url, m.storage_path, m.type, m.created_at
    FROM (
        SELECT
            media.*,
            ROW_NUMBER() OVER (
                PARTITION BY media.memory_id
                ORDER BY media.created_at ASC
            ) AS rn
        FROM media
        WHERE media.memory_id = ANY(p_memory_ids)
    ) m
    WHERE m.rn <= 2;
END;
$$;

REVOKE ALL ON FUNCTION get_timeline_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_timeline_thumbnails(uuid[]) TO authenticated;
```

Notes:
- `SECURITY INVOKER` → `media_select` RLS filters exactly as a plain `select` would. A non-member gets zero rows for that Space's memories (calm, same as reactions).
- `ROW_NUMBER() OVER (PARTITION BY ...)` is the standard per-group-limit pattern; `rn <= 2` gives the first 2 by `created_at ASC`.
- Returns durable B2 keys (`url`/`storage_path`), **not** presigned URLs — presigning happens client-side per thumbnail (Step 4), mirroring `MediaGallery`.

### Step 2 — `lib/media.ts`: add `fetchTimelineThumbnailsBatch`

**File:** [`app/avero/src/lib/media.ts`](app/avero/src/lib/media.ts) (edit)

A batch helper mirroring `fetchMemoryReactionsBatch`'s shape: takes `memoryIds`, returns `Record<string, Media[]>` (each Memory → its 1–2 thumbnail rows, oldest-first). Seeds every requested id with `[]` so the result is total (a Memory with no media maps to an empty array → card renders no thumbnail, no special-case branch). Empty input returns `{}` without a round trip. Throws on error; the page handles it calmly (cards render without thumbnails).

```ts
export async function fetchTimelineThumbnailsBatch(
  memoryIds: string[],
): Promise<Record<string, Media[]>> {
  const map: Record<string, Media[]> = {};
  for (const id of memoryIds) map[id] = [];
  if (memoryIds.length === 0) return map;

  const { data, error } = await supabase.rpc("get_timeline_thumbnails", {
    p_memory_ids: memoryIds,
  });
  if (error) throw error;

  for (const row of (data ?? []) as Media[]) {
    // Drop rows whose type isn't image/video (defensive, mirrors MediaGallery).
    if (asMediaType(row.type) === null) continue;
    map[row.memory_id]?.push(row);
  }
  return map;
}
```

### Step 3 — `SpaceDetailPage.tsx`: add thumbnails batch effect + state

**File:** [`app/avero/src/pages/SpaceDetailPage.tsx`](app/avero/src/pages/SpaceDetailPage.tsx) (edit)

- New state: `thumbnailsByMemoryId: Record<string, Media[]>`.
- New effect (separate from the reactions effect, same `[memories]` trigger, no `user` dep): calls `fetchTimelineThumbnailsBatch(memories.map(m => m.id))`, sets the map on success, clears to `{}` on calm failure. Mirrors the reactions effect's `cancelled` guard and "render the rest of the page" failure mode.
- Pass `thumbnails={thumbnailsByMemoryId[memory.id] ?? []}` into the new card component.

### Step 4 — New `MemoryThumbnail` component (poster-frame reuse + stacked effect)

**File:** `app/avero/src/components/media/MemoryThumbnail.tsx` (new)

Receives the 1–2 `Media` rows for a card. Resolves presigned URLs per media id via an effect + `inFlight` ref guard (the exact `MediaGallery` pattern, but for ≤2 items). Renders:
- **0 rows** → `null` (no placeholder, no broken-image icon — spec).
- **1 row** → a single ~64px square, `rounded-lg` (matches card radius), `object-cover`, hairline `border border-white/5`.
- **2 rows** → the first as the visible thumbnail; the second as a "peeking" edge behind it at a small offset + slight rotation (restrained — ~4px offset, ~3° rotation, lower z-index, same radius). Conveys "more than one" without cartoonishness.
- **Video (first row is `type: video`)** → `<video preload="metadata" muted pointer-events-none>` for the poster frame, **exactly** the `MediaTile` pattern (reused, not reinvented). No play affordance on the card thumbnail (the card isn't a media viewer — clicking navigates to Memory Detail).
- **URL resolution states** → `loading` (subtle skeleton pulse on the square), `ready` (image/poster), `error` (calm: render nothing — no broken icon; the card just has no thumbnail). This is calmer than the gallery's retry-on-tile because the thumbnail is decorative, not the primary content.

### Step 5 — New `MemoryTimelineCard` component (token-driven redesign)

**File:** `app/avero/src/components/media/MemoryTimelineCard.tsx` (new — or `components/memories/`; placing under `media/` is wrong since it's a Memory card, so `components/memories/`)

Extracting the card from the inline `<li>` map keeps `SpaceDetailPage` readable now that the card carries thumbnail + reaction control + token styling. Props: `memory`, `spaceId`, `tags` (string[]), `summary` (reaction summary), `isPending`, `onToggleReaction`, `thumbnails` (Media[]).

Visual redesign (all from v2.0 tokens — no one-off values):
- **Card surface:** `elevation-raised` → `bg-canvas-soft` + `border border-white/5`, `rounded-xl`. Replaces the current ad-hoc `hover:border-white/10 hover:bg-canvas-raised`.
- **Hover:** add `.hover-lift` (the canonical token-driven hover: translateY, accent border, one hairline glow). **Removes** the card's ad-hoc `transition-colors duration-200 hover:...`. This is the deliberate `.hover-lift` application the spec asks for.
- **Title:** `text-base font-semibold text-ink` (sans-serif, primary) — unchanged type, stays sans per §3.
- **Type badge:** `bg-accent-soft text-accent-400 rounded-full px-2.5 py-0.5 text-xs font-medium` — already token-correct; verify no hardcoded values. (Tag badges, if rendered, use the same accent-soft/accent-400 scale.)
- **Metadata row (date + location):** `font-mono text-xs text-ink-muted` — the signature typographic accent per §3. Date format per the confirmed decision (Step 1.3). Location, if present, separated by a middot or similar, same mono row.
- **Description:** `text-sm text-ink-muted line-clamp-3` (sans-serif) — unchanged.
- **Thumbnail:** top-right, ~64px square, `rounded-lg`, hairline border. Layout: the card body is a flex row — text content flexes left, thumbnail sits right with `shrink-0`. On very narrow widths the thumbnail stays (it's small); no wrap needed.
- **Reaction control:** `TimelineReactionControl` rendered as today, **visual tokens only** — no change to its interaction logic (long-press, popup, hint pulse). Verify its classes already use accent tokens (they do: `border-accent-500/60 bg-accent-soft`, `ring-accent-500/60`).
- **Navigation:** the card is a `<div>` (not a `<Link>`) so the reaction pill `<button>` isn't nested in an anchor. The **title** is the `<Link>` to Memory Detail, exactly as today. The thumbnail is **not** clickable to a lightbox — clicking the card/title still navigates to Memory Detail (spec: "No lightbox/click-to-enlarge from the card").

### Step 6 — `SpaceDetailPage.tsx`: render `MemoryTimelineCard` in the map

Replace the inline `<div className="rounded-xl border ...">` card markup with `<MemoryTimelineCard ... />` inside the `<li>`. The page keeps ownership of batch state and passes per-card props. The `formatMemoryDate` / `formatMemoryType` helpers move into the card component (or a shared util) since the card now owns rendering them.

### Step 7 — Verify

- **Visual:** card uses canvas-soft + hairline + `.hover-lift` glow; date/location in mono; type badge in accent-soft/accent-400; thumbnail top-right with restrained stacked effect for 2 photos; video poster frame for video-first.
- **Data:** one RPC round trip for all thumbnails; only 1–2 rows per Memory; presigned URLs resolved per-thumbnail (≤2 per card); no full-photo fetch.
- **Empty/no-media:** card with no media renders no thumbnail, no placeholder, no broken icon.
- **Navigation:** card/title click → Memory Detail; thumbnail click does nothing special (no lightbox).
- **RLS:** non-member gets no thumbnail rows (RPC is INVOKER + media_select RLS); cards render without thumbnails, calmly.
- **Reduced motion:** `.hover-lift` respects the global `prefers-reduced-motion` rule already in `index.css`.
- **Out of scope respected:** Memory Detail gallery untouched; SpaceCard untouched; reaction pill interaction untouched.

---

## 4. Files Touched

| File | Action |
|------|--------|
| `supabase/migrations/20260723110000_get_timeline_thumbnails_rpc.sql` | New — read-only `SECURITY INVOKER` RPC (per-group LIMIT 2) |
| [`app/avero/src/lib/media.ts`](app/avero/src/lib/media.ts) | Edit — add `fetchTimelineThumbnailsBatch` |
| [`app/avero/src/pages/SpaceDetailPage.tsx`](app/avero/src/pages/SpaceDetailPage.tsx) | Edit — thumbnails state + batch effect; render `MemoryTimelineCard` |
| `app/avero/src/components/memories/MemoryTimelineCard.tsx` | New — token-driven card |
| `app/avero/src/components/memories/MemoryThumbnail.tsx` | New — thumbnail + stacked effect + poster-frame reuse |

## 5. Out of Scope (explicit)
- Memory Detail page gallery — untouched.
- `SpaceCard.tsx` — separate next task.
- Reaction pill internal interaction logic (long-press, popup, hint) — visual tokens only.
- Media web optimizer / thumbnail-size variant at upload — flagged follow-up, not built here.
- Realtime updates — refresh-based, same as reactions (database §14).
