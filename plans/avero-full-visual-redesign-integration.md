# Avero Full Visual Redesign Integration Plan

**Stitch Exports → Production Codebase**

---

## 0. Source Material Analysis & Design Token Verification

### Stitch Export Inventory (13 pages + 5 modals)

| Screen | Export File | Theme Variants | Notes |
|--------|-------------|----------------|-------|
| Sign In | `avero_sign_in_memory_canvas_v2.0` | Light + Dark | Best exemplifies both themes |
| Sign Up | `avero_sign_up_responsive_v2.1` | Light + Dark | Best exemplifies both themes |
| Forgot Password | `avero_forgot_password_unified_dark_mode` | Light + Dark | Unified design |
| Create Space | `avero_create_a_space_theme_fixed` | Light + Dark | Two fields only (title, description) |
| Spaces Dashboard | `avero_spaces_design_system_synced` | Light + Dark | Multi-photo mosaic on cards |
| Space Detail / Timeline | `avero_space_detail_inset_card_redesign` | Light + Dark | Varying card layouts, Echoes row |
| Space Settings | `avero_space_settings_delete_confirmation_overlay` | Light + Dark | Inline invite section, delete modal |
| Space Stats | `avero_space_stats_theme_toggle_fixed` | Light + Dark | 12 achievements across 4 categories |
| Space Map | `avero_space_map_unified_theme` | Light + Dark | **Critical constraint** - live OSM/CartoDB tiles |
| Create Memory | `avero_create_a_memory_dark_theme_sync` | Light + Dark | Dark theme sync fix |
| Memory Detail | `avero_memory_detail_premium_polish` | Light + Dark | Full reaction set, comments |
| Edit Memory | `avero_edit_memory_theme_fully_fixed` | Light + Dark | Theme fully fixed |
| Settings | `avero_account_settings_theme_fixed` | Light + Dark | Theme fixed |

### Modals (5 prioritized)
1. **Avatar Crop Dialog** - **Already exists** (`AvatarCropDialog.tsx`), needs restyle to new tokens
2. **Confirm Delete Dialog** - Part of Space Settings export
3. **Media Lightbox** - **Already exists** (`MediaLightbox.tsx`), needs restyle to new tokens
4. **Location Autocomplete Dropdown** - Part of Create/Edit Memory exports
5. **Invite/Add Member** - **NOT a separate modal** - inline in Space Settings

### Design System Reference
- `avero_journal/DESIGN.md` - Complete design system specification
- `avero_spaces_design_system_synced` - Synced design tokens

---

## 1. Design System Token Updates (GLOBAL - Apply First)

### Confirmed Token Values (from DESIGN.md + auth exports)

| Token | Dark Theme | Light Theme | Notes |
|-------|------------|-------------|-------|
| **Canvas** | `#0b0b0c` (warm near-black) | `#fbf9f5` (warm off-white) | Not stark white |
| **Canvas Soft** | `#131314` | `#faf2ec` | Card backgrounds |
| **Canvas Raised** | `#1c1c1e` | `#ffffff` | Glass base |
| **Ink** | `#ececec` (off-white) | `#211f1a` (near-black) | Primary text |
| **Ink Muted** | `#8d8d8a` | `#6b6963` | Secondary text |
| **Ink Disabled** | `#5a5a57` | `#a3a199` | Disabled text |
| **Accent 400** | `#b89668` | `#6b5535` | Text/icons/links |
| **Accent 500** | `#9c7d52` | `#806540` | Core accent |
| **Accent 600** | `#806540` | `#806540` | Fills (same hex both themes for AA) |
| **Accent 700** | `#6b5535` | `#6b5535` | Pressed state |
| **Error** | `#c98a7a` (calm terracotta) | `#a76a58` (darkened terracotta) | Destructive only |
| **Accent RGB** | `184, 150, 104` | `107, 85, 53` | For glows/gradients |

### Motion & Elevation (Mirrored Both Themes)
- **Easing**: `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quint)
- **Hover Lift**: `translateY(-2px)` + accent border + hairline glow
- **Glass Panel**: `backdrop-filter: blur(16px) saturate(140%)` + translucent fill
- **Scrim**: `backdrop-filter: blur(8px)` + dark fill (both themes)

### Hard Rules (Non-Negotiable)
1. **One chromatic accent only**: Brass family (`#886548` dark / `#9c7d52` light)
2. **Calm terracotta reserved exclusively for destructive/delete actions**
3. **No other accent colors anywhere** - even if Stitch shows them
4. **Typography**: Inter for headings/body, JetBrains Mono for metadata (dates, counts, labels)
5. **Border radius**: 8px (0.5rem) for cards/inputs, full pill for badges

### Files to Update
- `app/avero/tailwind.config.js` - Color tokens, font families, motion tokens
- `app/avero/src/index.css` - CSS variables for both themes, glass/elevation utilities, motion patterns

---

## 2. Tier 1: Auth Pages (Foundational - Do First)

### 2.1 Sign In Page (`SignInPage.tsx`)

**Current State**: Uses `AuthShell` with ambient panel, `AuthFormPanel`, custom Google button with hardcoded colors

**Restyle (Visual Only)**:
- Update `AuthShell` ambient panel gradient to use new brass tokens
- Replace hardcoded Google button colors (`bg-white`, `text-[#3c4043]`) with design system tokens
- Update divider, form fields, buttons to use new token system
- Ensure both light/dark themes render correctly

**New Feature**: None

**Known Imperfections in Stitch**:
- Stitch uses custom CSS classes (`.bg-brass-solid`, `.text-brass-link`, `.focus-brass`) - must map to Tailwind tokens
- Photo stack on left panel is decorative only - keep as-is

### 2.2 Sign Up Page (`SignUpPage.tsx`)

**Current State**: Similar to Sign In with name field, email verification notice

**Restyle (Visual Only)**:
- Same token updates as Sign In
- Email verification notice screen needs same treatment
- "Use a different email" button styling

**New Feature**: None

**Known Imperfections**: Same as Sign In

### 2.3 Forgot Password Page (`ForgotPasswordPage.tsx`)

**Current State**: Single email field, recovery confirmation notice

**Restyle (Visual Only)**:
- Same token updates
- Recovery confirmation notice screen

**New Feature**: None

### 2.4 Auth Shell & Shared Components

**Files to Update**:
- `app/avero/src/components/auth/AuthShell.tsx` - Ambient panel gradient, wordmark
- `app/avero/src/components/auth/AuthFormPanel.tsx` - Form panel styling
- `app/avero/src/components/auth/AuthHeading.tsx` - Heading styles
- `app/avero/src/components/auth/BrandWordmark.tsx` - Wordmark (if exists)

**Verification**: Both themes, mobile viewport, build/lint pass

---

## 3. Tier 2: Shared Infrastructure - Multi-Photo Mosaic

### 3.1 Component: `MultiPhotoMosaic.tsx` (New Shared Component)

**Locations Used**:
1. **Spaces Dashboard** - Space cards: most recent photos across ALL memories in a Space
2. **Space Detail Timeline** - Memory cards: most recent photos within THAT specific Memory

**Props Interface**:
```typescript
interface MultiPhotoMosaicProps {
  media: Media[];           // Up to 3 Media items (thumbnail_grid_path)
  className?: string;       // Additional styling
  aspectRatio?: 'square' | 'landscape'; // Default square
}
```

**Layout States (Recomputed Every Load)**:
| Photo Count | Layout |
|-------------|--------|
| 0 | Calm placeholder (icon/pattern using accent sparingly) - **NOT blank** |
| 1 | Single image fills area |
| 2 | Two-photo split (50/50) |
| 3+ | Three-photo mosaic (always capped at 3) |

**Styling**: 
- `rounded-lg`, hairline border (`border-ink/5` dark / `border-outline-variant` light)
- Uses `thumbnail_grid_path` (300px WebP) - **never full-size originals**
- Hover: subtle scale (1.02) + transition

### 3.2 RPCs: Two Separate Functions (Confirmed Decision)

Following the existing pattern (`get_timeline_thumbnails` / `get_space_list_thumbnails`), we create **two separate RPCs** for cleaner separation and per-use-case optimization:

```sql
-- For Spaces Dashboard: most recent photos across ALL memories in a Space
CREATE FUNCTION get_space_mosaic_thumbnails(
  p_space_id uuid,
  p_limit int DEFAULT 3
) RETURNS SETOF media ...

-- For Space Detail Timeline: most recent photos within a specific Memory
CREATE FUNCTION get_memory_mosaic_thumbnails(
  p_memory_id uuid,
  p_limit int DEFAULT 3
) RETURNS SETOF media ...
```

**Security**: `SECURITY INVOKER` + `is_space_member` pattern (same as existing thumbnail RPCs)

**Batch Fetch Helpers** (New, in `app/avero/src/lib/media.ts`):
- `fetchSpaceMosaicThumbnailsBatch(spaceIds: string[])` - for Dashboard
- `fetchMemoryMosaicThumbnailsBatch(memoryIds: string[])` - for Timeline

### 3.3 Integration Points

**Spaces Dashboard** (`SpacesDashboardPage.tsx`):
- Replace `MemoryThumbnail` in `SpaceCard` with `MultiPhotoMosaic`
- Use new batch fetch `fetchSpaceMosaicThumbnailsBatch`

**Space Detail Timeline** (`SpaceDetailPage.tsx` + `MemoryTimelineCard.tsx`):
- Replace `MemoryThumbnail` in `MemoryTimelineCard` with `MultiPhotoMosaic`
- Use new batch fetch `fetchMemoryMosaicThumbnailsBatch`

### 3.4 Testing Requirements
- All 4 states (0, 1, 2, 3+ photos) render correctly with real data
- Both themes
- Dashboard/Timeline load time not regressed (quick before/after check)
- Empty state explicitly tested (not just 1-3 photo states)

---

## 4. Tier 3: Spaces Pages

### 4.1 Spaces Dashboard (`SpacesDashboardPage.tsx` + `SpaceCard.tsx`)

**Restyle**:
- Page header: "Your Spaces" + "Create a Space" button (accent-600)
- `SpaceCard`: Full token restyle (elevation-raised, hover-lift, mono role badge)
- **NEW**: Multi-photo mosaic replacing single thumbnail
- Empty state: Inspiring (SparkleIcon + brass accent)

**New Feature**: Multi-photo mosaic (shared component)

**Known Imperfections**: 
- Stitch shows 3 dashboard cards with different mosaic layouts - ensure our component handles all 4 states
- Third card in Stitch has single photo - verify our 1-photo state works

### 4.2 Create Space (`CreateSpacePage.tsx`)

**Restyle**:
- Centered card with `shadow-stone` (light) / border (dark)
- Input fields: Journal style (bottom-heavy focus border in light, recessed in dark)
- Primary button: Accent fill, hover lift
- Ghost link: Brass link color

**New Feature**: None (stays exactly 2 fields - title, description)

**Known Imperfections**: 
- Stitch uses `rounded-input` (16px) for fields - our design system uses 8px (rounded-lg)
- **Decision**: Use design system 8px radius for consistency

### 4.3 Space Detail / Timeline (`SpaceDetailPage.tsx` + `MemoryTimelineCard.tsx` + `EchoesCarousel.tsx`)

**Restyle**:
- Header: Space name + description + action icons (Map, Stats, Settings) in pill group
- Create Memory button: Accent fill
- **Echoes Carousel**: Horizontal scroll, snap-x, mono labels for intervals
- **Memory Cards**: Varying layouts (see §6 below)
- Sort + Search bar: Journal-style search input (bottom border focus)
- Empty states: Inspiring

**New Features**:
- Multi-photo mosaic on Memory cards (shared component)
- **Varying card layouts** - hero vs compact (see §6 for rule)

**Known Imperfections in Stitch**:
- Memory Item 1: 3-photo mosaic (hero layout)
- Memory Item 2: Single full-width photo (compact layout)
- **Must define deterministic rule** for which layout applies

### 4.4 Space Settings (`SpaceSettingsPage.tsx`)

**Restyle**:
- Header with inline Edit button
- Members list: `MemberRow` with avatar, name, role badge (mono)
- **Invite Section**: Inline (NOT a modal) - email input + Create Invite Link button
- Pending invites list
- **Danger Zone**: Split-tone card (error border/background), Delete button with calm terracotta outline
- **Delete Confirmation Dialog**: Typed-name confirmation, error-toned confirm button (calm terracotta, NOT harsh red)

**New Feature**: None (invite stays inline)

**Known Bugs to Fix**:
- Delete confirmation dialog not adapting to dark theme (split-tone card bug, blur on wrong layer)
- Harsh red button → calm terracotta outline (per destructive-action color rule)

### 4.5 Space Stats (`SpaceStatsPage.tsx`)

**Restyle**:
- Header strip: Space name + mono summary line
- **Key Numbers Grid**: 6 stat tiles (elevation-raised, mono numbers, brass accent)
- **Timeline Density**: Monthly bar chart (monochrome + brass peak month) - pure React/CSS
- **Achievements Grid**: 12 achievements across 4 categories (milestone, time, collaboration, variety)
  - Unlocked: Full color, unlock date (mono)
  - Locked: Dimmed/grayscale, title visible, description hidden behind hint
- **Supplementary Facts**: Sentences, not raw numbers

**New Feature**: None (data already exists)

**Known Bugs to Fix**:
- Two achievement categories accidentally dropped in earlier pass
- Locked/unlocked color logic inverted
- **Must verify**: All 12 achievements across 4 categories show correctly with proper locked/unlocked states

### 4.6 Space Map (`SpaceMapPage.tsx`)

**CRITICAL CONSTRAINT**: Live map tiles (OSM light / CartoDB Dark Matter) via Leaflet - **cannot apply Stitch's custom warm-toned map design directly**

**Decision Required** (Report Before Implementing):

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **1. Accept Standard Tiles** | Keep OSM/CartoDB tiles, only match pin/marker design to Stitch | Cheapest, realistic, works today | Map looks more generic than mockup |
| **2. Custom Tile Style** | Investigate free custom map styling (Mapbox Studio, etc.) | Could match Stitch mockup | Most free tiers limited/paid; may not exist |

**Recommendation**: **Option 1** unless investigation turns up genuinely free path

**What TO Implement** (Regardless of Option):
- Pin/marker design: Shape, color, accent-colored pin (already implemented)
- Pin clustering for 2+ memories at same location
- Tooltips on hover with memory title + date
- Map controls (zoom in/out) styled to design system
- Attribution (LocationIQ + OSM + CARTO per ToS)
- Empty state: Inspiring message

**Investigation Needed**: Check if any free custom tile service exists (Mapbox free tier, Stadia Maps, etc.)

---

## 5. Tier 4: Memories Pages

### 5.1 Create Memory (`CreateMemoryPage.tsx`)

**Restyle**:
- Centered form card (max-w-[420px])
- Journal-style inputs (bottom-heavy focus in light, recessed in dark)
- Native `<select>` for Memory type (styled to match)
- Date picker: Native `<input type="date">`
- **LocationAutocomplete**: Integrated (already exists)
- **TagInput**: Multi-tag input (already exists)
- **Photos & Videos**: Dashed border dropzone, file status list
- Primary button: Accent fill, disabled until uploads complete

**New Feature**: None (media upload already implemented)

**Known Bugs to Fix**:
- Dark mode bug: Inputs stayed light/cream, labels rendered in random colors
- **Must verify**: All inputs use design system tokens in both themes

### 5.2 Memory Detail (`MemoryDetailPage.tsx`)

**Restyle**:
- Header: Title + type badge + Edit/Delete (creator OR owner)
- Metadata row: Mono date + location
- Description: `whitespace-pre-line`
- **Media Gallery**: Grid (already exists)
- **Reaction Bar**: Full 6-emoji set (❤️ 😂 🔥 🥹 👏 😮) - **NOT reduced to heart+count**
- **Comment List**: With per-comment reactions (6 types)

**New Feature**: None

**Known Bugs to Fix**:
- Comment-reactions regression: Collapsed to plain "Like" link at one point
- **Must verify**: Full 6-type reaction system per comment works (Phase 6 spec)

**Clarification Needed** (from §8):
- Timeline card mockups show simplified heart+count
- **Confirm**: Is this a card-level summary (tap/expand reveals full set) or intentional reduction?
- **Default assumption**: Card-level summary, full set on detail page (consistent with existing spec)

### 5.3 Edit Memory (`EditMemoryPage.tsx`)

**Restyle**:
- Same as Create Memory but pre-filled
- No media section (text-fields only)
- Tags: Pre-filled + visual tag pills with remove buttons
- Authorization: Creator OR Space owner (redirects to detail if unauthorized)

**New Feature**: None

**Known Bugs to Fix**: Same dark mode input bug as Create Memory

---

## 6. Tier 5: Account Settings (`SettingsPage.tsx`)

**Restyle**:
- **Profile Section**: Large avatar (96px) with edit overlay, display name field, read-only email (lock icon)
- **Theme Section**: Segmented selector (Dark/Light) - selected = accent fill
- **Account Section**: Sign out button (error outline, calm terracotta)

**New Feature**: None

**Known Issues**: 
- Theme selector buttons need proper active state styling in both themes
- Avatar upload reuses existing `AvatarUpload` pipeline

---

## 7. Tier 6: Modals (5 Prioritized)

### 7.1 Avatar Crop Dialog
- **Status**: **Already exists** (`app/avero/src/components/ui/AvatarCropDialog.tsx`)
- **Restyle**: Update to new design system tokens (canvas, ink, accent, glass panel, scrim)
- **No Stitch export** - inherit host page styling with new token system

### 7.2 Confirm Delete Dialog
- **Status**: Part of Space Settings export
- **Restyle**: Split-tone card, typed-name confirmation, calm terracotta confirm button
- **Reuse**: Generic `ConfirmDialog` component with props for destructive variant

### 7.3 Media Lightbox
- **Status**: **Already exists** (`app/avero/src/components/media/MediaLightbox.tsx`)
- **Restyle**: Update to new design system tokens (scrim, glass panel, navigation controls)
- **No Stitch export** - inherit host styling with new token system

### 7.4 Location Autocomplete Dropdown
- **Status**: Part of Create/Edit Memory exports
- **Restyle**: Dropdown matches design system (glass panel, mono labels)
- **Component**: Existing `LocationAutocomplete` - update dropdown styling

### 7.5 Invite/Add Member
- **Status**: **NOT a separate modal** - inline in Space Settings
- **Action**: Style existing inline section only

---

## 8. Known Bugs to Fix During This Pass

| Bug | Location | Fix |
|-----|----------|-----|
| Broken third-card layout (unusual photo count) | Space Dashboard | MultiPhotoMosaic handles all 4 states explicitly |
| Empty mosaic gap-tiles | Space Detail/Timeline | MultiPhotoMosaic 0-state = calm placeholder |
| Invisible dark-mode pill text on category labels | Space Detail/Timeline | Ensure mono labels use `text-ink-muted` not `text-ink-disabled` |
| Delete confirmation dialog dark theme (split-tone, wrong blur layer) | Space Settings | Fix glass panel usage, error/terracotta tokens |
| Harsh red delete button | Space Settings | Change to calm terracotta outline (`border-error text-error`) |
| Two achievement categories dropped | Space Stats | Verify all 12 achievements render |
| Locked/unlocked color logic inverted | Space Stats | Unlocked = full color, Locked = dimmed/grayscale |
| Create Memory dark mode: inputs light/cream, random label colors | Create/Edit Memory | All inputs use design system tokens |
| Comment reactions collapsed to "Like" link | Memory Detail | Verify full 6-type reaction system per comment |

---

## 9. Reaction Display Clarification (§8)

**Question**: Timeline card mockups show simplified heart+count instead of full 6-emoji set.

**Options**:
- **A. Card-level summary**: Heart+count on card, tap/expand reveals full 6-type reaction picker (consistent with existing Phase 6 spec)
- **B. Intentional reduction**: Reduce reaction system to single like button (BREAKING CHANGE - requires explicit confirmation)

**Recommendation**: **Option A** - card summary with full system on detail page

**Do NOT implement reduction without explicit confirmation** - would be functional regression from feature-specs.md §5.

---

## 10. Explicitly Confirmed Non-Changes (Do Not Add Scope)

| Item | Status |
|------|--------|
| Create Space: Cover photo | ❌ No - stays 2 fields |
| Create Space: Invite on creation | ❌ No - deliberately restrained |
| Invite/Add Member modal | ❌ No - stays inline in Space Settings |
| Auth Callback design treatment | ❌ No - remains plain transient loading |

---

## 11. Verification Checklist (Per Page/Component)

For EVERY item in the inventory:

- [ ] **Light theme** renders correctly
- [ ] **Dark theme** renders correctly (explicit re-check - pattern of dark-mode bugs)
- [ ] **Mobile viewport** (375px, 768px breakpoints)
- [ ] **All functionality** works after visual overhaul (no silent breaks)
- [ ] **Build passes** (`npm run build`)
- [ ] **Lint passes** (`npm run lint`)
- [ ] **Empty states** tested (0, 1, 2, 3+ photos for mosaic)
- [ ] **Hover/focus states** work with design system tokens

**Build/Lint Cadence**: After each major tier (§3), not just at end

---

## 12. Commit Strategy

- **Feature branch**: `redesign/stitch-integration-v2`
- **Incremental commits by tier**:
  1. `feat(design-system): update tokens for Avero Journal dual theme`
  2. `feat(auth): restyle Sign In, Sign Up, Forgot Password`
  3. `feat(shared): add MultiPhotoMosaic component + RPCs`
  4. `feat(spaces): restyle Dashboard, Create Space, Detail, Settings, Stats, Map`
  5. `feat(memories): restyle Create, Detail, Edit Memory`
  6. `feat(settings): restyle Account Settings`
  7. `feat(modals): restyle 5 prioritized modals`
  8. `fix: address all known bugs from design QA`
- **Preview deployment** testing before merge to main
- **Higher blast radius** than any single feature - treat accordingly

---

## 13. Decisions — CONFIRMED

All 5 decisions confirmed by user:

1. **Space Map**: ✅ **Option 1** — Accept standard OSM (light) / CartoDB Dark Matter (dark) tiles, match only pin/marker design to Stitch
2. **Memory Card Layout**: ✅ **3+ photos → hero layout; ≤2 photos → compact layout** (deterministic, based on photo count)
3. **Reaction Display**: ✅ **Option A** — Card-level summary (heart+count) on Timeline cards, full 6-emoji set preserved on Memory Detail page
4. **RPC Approach**: ✅ **Two separate RPCs** — `get_space_mosaic_thumbnails` + `get_memory_mosaic_thumbnails` (matching existing pattern)
5. **Border Radius**: ✅ **Design system 8px (rounded-lg)** for form fields, not Stitch's 16px

---

## 14. File Inventory (What Will Be Modified)

### Design System (Global)
- `app/avero/tailwind.config.js`
- `app/avero/src/index.css`

### Auth (Tier 1)
- `app/avero/src/pages/SignInPage.tsx`
- `app/avero/src/pages/SignUpPage.tsx`
- `app/avero/src/pages/ForgotPasswordPage.tsx`
- `app/avero/src/components/auth/AuthShell.tsx`
- `app/avero/src/components/auth/AuthFormPanel.tsx`
- `app/avero/src/components/auth/AuthHeading.tsx`
- `app/avero/src/components/auth/BrandWordmark.tsx`

### Shared Infrastructure (Tier 2)
- `app/avero/src/components/ui/MultiPhotoMosaic.tsx` (NEW)
- `app/avero/src/lib/media.ts` (add batch fetch helpers)
- `supabase/migrations/xxx_get_mosaic_thumbnails_rpc.sql` (NEW - 2 RPCs)

### Spaces (Tier 3)
- `app/avero/src/pages/SpacesDashboardPage.tsx`
- `app/avero/src/components/spaces/SpaceCard.tsx`
- `app/avero/src/pages/CreateSpacePage.tsx`
- `app/avero/src/pages/SpaceDetailPage.tsx`
- `app/avero/src/components/memories/MemoryTimelineCard.tsx`
- `app/avero/src/components/memories/EchoesCarousel.tsx`
- `app/avero/src/pages/SpaceSettingsPage.tsx`
- `app/avero/src/components/spaces/MemberRow.tsx`
- `app/avero/src/pages/SpaceStatsPage.tsx`
- `app/avero/src/pages/SpaceMapPage.tsx`

### Memories (Tier 4)
- `app/avero/src/pages/CreateMemoryPage.tsx`
- `app/avero/src/pages/MemoryDetailPage.tsx`
- `app/avero/src/pages/EditMemoryPage.tsx`
- `app/avero/src/components/media/MediaGallery.tsx`
- `app/avero/src/components/reactions/ReactionBar.tsx`
- `app/avero/src/components/reactions/TimelineReactionControl.tsx`
- `app/avero/src/components/comments/CommentList.tsx`
- `app/avero/src/components/comments/CommentReactionControl.tsx`
- `app/avero/src/components/ui/LocationAutocomplete.tsx`
- `app/avero/src/components/ui/TagInput.tsx`

### Account (Tier 5)
- `app/avero/src/pages/SettingsPage.tsx`
- `app/avero/src/components/ui/AvatarUpload.tsx`

### Modals (Tier 6)
- `app/avero/src/components/ui/ConfirmDialog.tsx` (update for destructive variant)
- `app/avero/src/components/media/MediaLightbox.tsx` (restyle existing)
- `app/avero/src/components/ui/AvatarCropDialog.tsx` (restyle existing)

---

## 15. Execution Order

```
Phase 0: Design System Tokens (tailwind.config.js + index.css)
    ↓
Phase 1: Auth Pages (Sign In, Sign Up, Forgot Password) + AuthShell
    ↓
Phase 2: MultiPhotoMosaic Component + RPCs + Batch Helpers
    ↓
Phase 3: Spaces Pages (Dashboard → Create → Detail → Settings → Stats → Map)
    ↓
Phase 4: Memories Pages (Create → Detail → Edit)
    ↓
Phase 5: Account Settings
    ↓
Phase 6: Modals (Confirm Delete, Media Lightbox, Avatar Crop, Location Autocomplete)
    ↓
Phase 7: Bug Fixes + Cross-Theme Verification + Build/Lint per Tier
```

---

**Plan Complete** - Ready for review before switching to Code mode.