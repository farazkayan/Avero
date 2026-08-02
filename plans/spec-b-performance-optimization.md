# SPEC B: Major Performance & Media Optimization Pass - Implementation Plan

## Overview
This plan covers the complete SPEC B optimization pass, organized into 6 phases (B.0 through B.6). Each phase B.1-B.4 will be executed and reported individually before moving to the next.

---

## B.0: Establish Performance Baselines

### Goals
Capture baseline metrics before any optimizations to enable before/after comparison.

### Tasks
1. **Lighthouse CI / DevTools Audit**
   - Run Lighthouse on 3 key pages: SpaceDetailPage (timeline), MemoryDetailPage (gallery), SpaceStatsPage
   - Capture: Performance, Accessibility, Best Practices, SEO scores
   - Capture Core Web Vitals: LCP, CLS, TBT, FCP, SI
   - Device: Mobile (simulated) + Desktop

2. **Bundle Size Analysis**
   - Run `npm run build` and capture:
     - Total bundle size (gzipped)
     - Per-chunk sizes
     - Largest dependencies
   - Use `vite-bundle-analyzer` or `rollup-plugin-visualizer`

3. **Network Metrics (DevTools)**
   - Record HAR files for:
     - Cold load of SpaceDetailPage with 50+ memories
     - MemoryDetailPage with 10+ media items
     - SpaceStatsPage
   - Capture: Total bytes transferred, request count, waterfall timing

4. **Database Query Baselines**
   - Enable `pg_stat_statements` or use Supabase query insights
   - Capture query counts and durations for:
     - Timeline fetch (SpaceDetailPage)
     - Memory detail fetch
     - Stats page fetch
     - Thumbnail batch fetches

### Deliverable
`baseline-report.md` with all metrics captured.

---

## B.1: Image Compression & Delivery Optimization

### Current State Analysis
| Aspect | Current | Spec Target |
|--------|---------|-------------|
| Original image max edge | 2000px (JPEG q0.8) | 2560px (WebP q0.82) |
| Thumbnail (grid) | 400px WebP q78 | 300px WebP q75 |
| Thumbnail (detail) | N/A (uses original) | 1000px WebP q80 |
| Video poster | 400px WebP q0.78 | 1000px WebP q80 |
| Presigned URL caching | Session-scoped in-memory | ✅ Already implemented |
| Thumbnail generation | Server-side (Edge Function) | ✅ Already implemented |

### Tasks

#### 1.1 Update Client-Side Image Compression (`lib/media.ts`)
- **File**: `app/avero/src/lib/media.ts`
- **Function**: `compressImage` (lines ~375-405)
- **Changes**:
  - Increase max edge from 2000 → 2560
  - Change output format from JPEG → WebP
  - Adjust quality from 0.8 → 0.82
  - Maintain EXIF orientation handling

#### 1.2 Update Server-Side Thumbnail Generation (`supabase/functions/media-thumbnail/index.ts`)
- **File**: `supabase/functions/media-thumbnail/index.ts`
- **Function**: `generateImageThumbnail` (lines ~414-440) and `handleGenerateThumbnail` (lines ~446-559)
- **Changes**:
  - Add two thumbnail sizes:
    - Grid: 300px max edge, WebP quality 75
    - Detail: 1000px max edge, WebP quality 80
  - Store both paths in DB (new columns or JSON field)
  - Update `deriveThumbnailKey` to support size variants

#### 1.3 Update Video Poster Generation (`lib/media.ts`)
- **File**: `app/avero/src/lib/media.ts`
- **Function**: `extractVideoPoster` (lines ~678-739) and `uploadVideoPoster` (lines ~752-787)
- **Changes**:
  - Increase poster size from 400px → 1000px max edge
  - Change quality from 0.78 → 0.80
  - Ensure WebP output

#### 1.4 Database Schema Updates
- **Migration**: Add `thumbnail_grid_path` and `thumbnail_detail_path` columns to `media` table
- **Backfill**: Generate new thumbnails for existing media (optional, can be lazy)

#### 1.5 Update Thumbnail Consumers
- **MemoryThumbnail.tsx**: Use 300px grid thumbnail
- **MediaGallery.tsx**: Use 1000px detail thumbnail for lightbox placeholder
- **MediaTile.tsx**: Use appropriate thumbnail based on context

#### 1.6 Verify Presigned URL Caching Coverage
- Audit all media download paths in `lib/media.ts` and `lib/avatar.ts`
- Confirm `getCachedDownloadUrl` / `getCachedAvatarDownloadUrl` used everywhere
- Add cache-busting for thumbnail variants

### Acceptance Criteria
- [ ] Original images: ≤2560px, WebP q0.82
- [ ] Grid thumbnails: 300px WebP q75
- [ ] Detail thumbnails: 1000px WebP q80
- [ ] Video posters: 1000px WebP q80
- [ ] All media paths use presigned URL caching
- [ ] Lighthouse Performance score improves by ≥5 points

---

## B.2: Lazy Loading & Rendering Optimization

### Current State Analysis
| Aspect | Current | Spec Target |
|--------|---------|-------------|
| Timeline thumbnails | IntersectionObserver (200px rootMargin) | ✅ + LQIP blur placeholders |
| MediaGallery images | `loading="lazy"` | ✅ + LQIP |
| Virtualization | None | react-window for 100+ items |
| Memory cards | Full render | Virtualized list |

### Tasks

#### 2.1 Add LQIP (Low-Quality Image Placeholders)
- **Files**: `MemoryThumbnail.tsx`, `MediaTile.tsx`, `MediaGallery.tsx`
- **Approach**:
  - Generate tiny (20px) base64 blur placeholder during thumbnail generation
  - Store as `blur_data_url` in media table or compute client-side from thumbnail
  - Render as background-image with blur filter while loading

#### 2.2 Implement Virtualization for Timeline
- **File**: `SpaceDetailPage.tsx` (lines ~502-522 where memories map)
- **Dependency**: Add `react-window` (or `@tanstack/react-virtual`)
- **Implementation**:
  - Wrap memory list in `FixedSizeList` or `VariableSizeList`
  - Item height: ~200px (MemoryTimelineCard)
  - Overscan: 5 items
  - Maintain search/filter functionality

#### 2.3 Virtualize Media Gallery Grid
- **File**: `MediaGallery.tsx` (lines ~571-588)
- **Implementation**:
  - Use `react-window` `FixedSizeGrid` for media tiles
  - Only render visible tiles + buffer
  - Maintain lightbox functionality

#### 2.4 Optimize IntersectionObserver Thresholds
- **File**: `MemoryThumbnail.tsx` (lines ~128-140)
- **Changes**:
  - Increase rootMargin from 200px → 300px for earlier loading
  - Add `threshold: [0, 0.1, 0.5]` for progressive loading

#### 2.5 Add `loading="lazy"` to All Images
- Audit all `<img>` and `<video>` elements
- Ensure `loading="lazy"` on below-fold content
- Add `fetchpriority="high"` for LCP candidates (first timeline thumbnail, hero image)

### Acceptance Criteria
- [ ] LQIP blur placeholders on all thumbnail images
- [ ] Virtualized timeline for 100+ memories (60fps scroll)
- [ ] Virtualized media gallery grid
- [ ] IntersectionObserver optimized for earlier loading
- [ ] No layout shift (CLS < 0.1) during image loads

---

## B.3: Bundle Size & Code Splitting

### Current State Analysis
| Aspect | Current | Spec Target |
|--------|---------|-------------|
| Route-level splitting | None | React.lazy on all routes |
| Manual chunks | None | Vendor, UI, Supabase chunks |
| Dynamic imports | None | Heavy components lazy-loaded |
| Bundle analysis | Not configured | rollup-plugin-visualizer |

### Tasks

#### 3.1 Configure Vite for Code Splitting
- **File**: `vite.config.ts`
- **Changes**:
  ```typescript
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-ui': ['@radix-ui/*', 'lucide-react'], // if used
        }
      }
    }
  }
  ```

#### 3.2 Implement Route-Level Code Splitting
- **File**: `App.tsx`
- **Changes**: Wrap all page imports in `React.lazy()`
- **Add**: `<Suspense>` boundary in AppShell or root layout
- **Routes to split** (14 routes):
  - SignInPage, SignUpPage, ForgotPasswordPage, VerifyEmailPage, ResetPasswordPage, AcceptInvitePage
  - SpacesDashboardPage, CreateSpacePage, SpaceDetailPage, SpaceSettingsPage, SpaceStatsPage
  - SettingsPage, CreateMemoryPage, MemoryDetailPage, EditMemoryPage

#### 3.3 Lazy-Load Heavy Components
- **Components**:
  - `MediaGallery` (large, only on MemoryDetailPage)
  - `MediaLightbox` (only when opened)
  - `AchievementsGrid` (only on SpaceStatsPage)
  - `TimelineDensity` (only on SpaceStatsPage)
  - `AvatarCropDialog` (only when cropping)
  - `ConfirmDialog` (only when triggered)

#### 3.4 Add Bundle Analysis
- **Dev Dependency**: `rollup-plugin-visualizer`
- **Script**: `npm run build:analyze` → opens visualizer
- **CI**: Fail build if total gzipped JS > 200KB (adjust based on baseline)

#### 3.5 Tree-Shaking Audit
- Verify no side effects in package.json
- Check for unused exports in lib/ modules
- Ensure `sideEffects: false` in package.json (or per-file)

### Acceptance Criteria
- [ ] Route-level code splitting on all 14 routes
- [ ] Vendor chunks separated (react, supabase, ui)
- [ ] Heavy components lazy-loaded
- [ ] Initial JS bundle < 100KB gzipped (target)
- [ ] Bundle analyzer configured and passing

---

## B.4: Database Query Performance

### Current State Analysis
| Aspect | Current | Spec Target |
|--------|---------|-------------|
| Partial index on memories | ✅ `idx_memories_space_date_active` | Verify + optimize |
| N+1 queries | Need audit | Eliminate |
| Stats recompute triggers | Lightweight (ON CONFLICT DO NOTHING) | Verify |
| Batch thumbnail fetches | ✅ RPC functions exist | Verify usage |

### Tasks

#### 4.1 Verify Partial Index Usage
- **Check**: `EXPLAIN ANALYZE` on timeline query in SpaceDetailPage
- **Query**: `SELECT * FROM memories WHERE space_id = $1 AND deleted_at IS NULL ORDER BY memory_date DESC`
- **Confirm**: Index `idx_memories_space_date_active` is used
- **Optimize**: Add `LIMIT` with cursor-based pagination if not present

#### 4.2 Audit N+1 Queries
- **SpaceDetailPage.tsx**:
  - `fetchSpaceTimeline` → fetches memories
  - `fetchBatch` for reactions → uses RPC `get_timeline_thumbnails` ✅
  - `fetchBatch` for thumbnails → uses RPC `get_timeline_thumbnails` ✅
  - **Check**: Member fetch for edit permissions (line ~181-210) - only when needed ✅

- **MemoryDetailPage.tsx**:
  - Memory fetch → single query ✅
  - Tags fetch → separate query (could join)
  - Members fetch → only for non-creators ✅
  - MediaGallery → fetches media + presigned URLs (batched via RPC?)

- **MediaGallery.tsx**:
  - `fetchMedia` → single query for media rows
  - `resolveTile` → individual `getMediaDownloadUrl` calls (N+1!)
  - **Fix**: Batch presigned URL requests

#### 4.3 Optimize Presigned URL Batch Fetching
- **File**: `lib/media.ts`
- **Functions**: `fetchTimelineThumbnailsBatch`, `fetchSpaceListThumbnailsBatch`
- **Extend**: Add `fetchMediaDownloadUrlsBatch` for MediaGallery
- **Usage**: Update MediaGallery to batch all download URLs in one RPC call

#### 4.4 Audit Stats Recompute Triggers
- **File**: `supabase/migrations/20260729100000_space_stats_achievements.sql` (lines 272-442)
- **Verify**:
  - Triggers use `ON CONFLICT DO NOTHING` (idempotent) ✅
  - No heavy computation in triggers ✅
  - Only INSERT/DELETE trigger (not UPDATE, except memories) ✅
  - pg_cron job runs every minute (not every write) ✅

#### 4.5 Add Missing Indexes (if needed)
- **Check**: `media` table - index on `memory_id` exists ✅
- **Check**: `reactions` - index on `memory_id` exists ✅
- **Check**: `comments` - index on `memory_id, created_at` exists ✅
- **Add**: Composite index for media thumbnail lookups if needed

#### 4.6 Implement Cursor-Based Pagination
- **SpaceDetailPage**: Replace offset pagination with cursor-based
- **MemoryDetailPage**: Media gallery pagination
- **Benefit**: Consistent performance regardless of page depth

### Acceptance Criteria
- [ ] Partial index confirmed used by timeline query
- [ ] Zero N+1 queries on key pages (batched RPC calls)
- [ ] Stats triggers verified lightweight
- [ ] Cursor-based pagination implemented
- [ ] Query count reduced by ≥50% on timeline load

---

## B.5: Before/After Comparison Report

### Tasks
1. Re-run all B.0 baseline measurements
2. Create comparison table:
   | Metric | Before | After | Change |
   |--------|--------|-------|--------|
   | Lighthouse Performance (Mobile) | X | Y | +Z |
   | Lighthouse Performance (Desktop) | X | Y | +Z |
   | Total JS Bundle (gzipped) | X KB | Y KB | -Z% |
   | Initial Chunk (gzipped) | X KB | Y KB | -Z% |
   | Timeline Load Time | X ms | Y ms | -Z% |
   | Memory Detail Load Time | X ms | Y ms | -Z% |
   | Network Requests (timeline) | X | Y | -Z |
   | DB Queries (timeline) | X | Y | -Z |
   | CLS | X | Y | -Z |
   | LCP | X ms | Y ms | -Z ms |

3. Document any regressions and mitigations
4. Create `optimization-report.md` with findings

---

## B.6: Commit & Push Changes

### Tasks
1. Create feature branch: `spec-b/performance-optimization`
2. Commit each phase (B.1-B.4) as separate logical commits
3. Run full test suite: `npm run lint && npm run build`
4. Push to remote
5. Create PR with optimization report

---

## Execution Order & Dependencies

```
B.0 (Baselines) → B.1 (Images) → B.2 (Lazy/Virtual) → B.3 (Bundle) → B.4 (DB) → B.5 (Report) → B.6 (Commit)
                    ↓                    ↓
               Independent          Depends on B.1 thumbnails
                    ↓                    ↓
               Independent          Independent
```

**Parallelizable**: B.1 and B.3 can run in parallel after B.0. B.2 depends on B.1 thumbnail sizes. B.4 is independent.

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| WebP browser support | All target browsers support WebP (caniuse: 97%+). Fallback to JPEG via `<picture>` if needed. |
| Virtualization breaks accessibility | Use `react-window` with proper ARIA attributes. Test with screen readers. |
| Code splitting causes flash | Use `<Suspense>` with skeleton loaders. Preload critical routes. |
| Thumbnail migration breaks old media | Keep fallback to original URL. Generate thumbnails on-demand for old media. |
| Bundle size regression | CI gate with `rollup-plugin-visualizer` budget. |

---

## File Change Summary

### B.1 - Image Compression
- `app/avero/src/lib/media.ts` - Client compression, video poster
- `supabase/functions/media-thumbnail/index.ts` - Server thumbnails (2 sizes)
- `supabase/migrations/XXXX_add_thumbnail_variants.sql` - New columns
- `app/avero/src/components/memories/MemoryThumbnail.tsx` - Use grid thumbnail
- `app/avero/src/components/media/MediaTile.tsx` - Use detail thumbnail
- `app/avero/src/components/media/MediaGallery.tsx` - LQIP support

### B.2 - Lazy Loading & Virtualization
- `app/avero/src/pages/SpaceDetailPage.tsx` - Virtualized timeline
- `app/avero/src/components/media/MediaGallery.tsx` - Virtualized grid
- `app/avero/src/components/memories/MemoryThumbnail.tsx` - LQIP, optimized IO
- `app/avero/src/components/media/MediaTile.tsx` - LQIP
- `package.json` - Add `react-window`

### B.3 - Bundle & Code Splitting
- `app/avero/vite.config.ts` - Manual chunks, analyzer
- `app/avero/src/App.tsx` - React.lazy routes
- `app/avero/src/components/AppShell.tsx` - Suspense boundary
- `package.json` - Add `rollup-plugin-visualizer`, build:analyze script
- Multiple component files - React.lazy heavy components

### B.4 - Database Performance
- `app/avero/src/lib/media.ts` - Batch download URL function
- `app/avero/src/components/media/MediaGallery.tsx` - Use batch fetch
- `supabase/migrations/XXXX_add_media_batch_rpc.sql` - New RPC if needed
- `app/avero/src/pages/SpaceDetailPage.tsx` - Cursor pagination

---

## Next Steps

1. **Immediate**: Run B.0 baselines (requires dev server running)
2. **Then**: Execute B.1 through B.4 sequentially with reporting after each
3. **Finally**: B.5 report and B.6 commit

---

*Plan created: 2026-07-31*
*Status: Ready for B.0 baseline capture*