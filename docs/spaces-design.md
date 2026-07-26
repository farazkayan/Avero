# Avero — Spaces Feature Design (Phase 2)

**Version:** 0.1 (Draft — pending confirmation)

**Status:** 🟡 In Review

**Scope:** Full design for the Spaces feature — dashboard, creation, detail/settings, invitations (send + accept + auto-attach), and all edge cases. This is a planning document; no implementation code is included.

**Aligned with:** [`blueprint.md`](docs/blueprint.md), [`feature-specs.md`](docs/feature-specs.md), [`database.md`](docs/database.md), [`backend-implementation.md`](docs/backend-implementation.md), [`ai-context.md`](docs/ai-context.md), [`auth-design.md`](docs/auth-design.md), [`design-system.md`](docs/design-system.md), [`roadmap.md`](docs/roadmap.md).

> This document covers Phase 2 (Spaces) per [`roadmap.md`](docs/roadmap.md). It assumes Phase 1 (Foundation) is complete — auth works, the Supabase schema and RLS policies are migrated, and [`SpacesPlaceholderPage.tsx`](app/avero/src/pages/SpacesPlaceholderPage.tsx) is the temporary authenticated landing page.

---

## Table of Contents

1. [Confirmed Spec](#1-confirmed-spec)
2. [RLS Policy Analysis — Gaps in the Existing 37 Policies](#2-rls-policy-analysis--gaps-in-the-existing-37-policies)
3. [Database Changes Required](#3-database-changes-required)
4. [Data Fetching Strategy](#4-data-fetching-strategy)
5. [Component & Page Structure](#5-component--page-structure)
6. [Screen-by-Screen Design](#6-screen-by-screen-design)
7. [Exact Supabase Calls per Flow](#7-exact-supabase-calls-per-flow)
8. [Edge Cases & Handling](#8-edge-cases--handling)
9. [Existing Code Touched vs Net-New](#9-existing-code-touched-vs-net-new)
10. [Open Questions & Conflicts to Confirm](#10-open-questions--conflicts-to-confirm)

---

# 1. Confirmed Spec

## 1.1 Roles

| Capability | Owner | Member |
|---|---|---|
| Invite members | ✅ | ❌ |
| Remove members | ✅ | ❌ |
| Edit space name/description | ✅ | ❌ |
| Delete space | ✅ | ❌ |
| Create/edit/delete own memories | ✅ | ✅ |
| Edit/delete others' memories | ✅ | ❌ |
| Leave the space | ✅ | ❌ |

> Memory CRUD is Phase 3 scope, but the RLS policies already enforce these distinctions (see [§2.1](#21-role-based-access--fully-covered)). Phase 2 only builds the Spaces management UI; memory screens come later.

## 1.2 Invitations

- **Invite by email** — no username search feature exists.
- **7-day expiry** on pending invites (`expires_at = now() + interval '7 days'`).
- **Block inviting an email that's already a member** — clear error, no duplicate rows.
- **No-account invitee** — the invite persists and auto-attaches (becomes discoverable) when that email signs up and verifies.
- **Removed/leaving inviter** — see [§8.4](#84-inviting-owner-removed-or-leaves).
- **Space deleted** — see [§8.5](#85-space-deleted-with-pending-invites).

---

# 2. RLS Policy Analysis — Gaps in the Existing 37 Policies

The existing 37 RLS policies (defined in [`20260703171000_rls_policies.sql`](supabase/migrations/20260703171000_rls_policies.sql)) were designed for the full schema but have not yet been exercised by a real frontend. Phase 2 is the first time `spaces`, `space_members`, and `space_invitations` are used by the application.

## 2.1 Role-Based Access — Fully Covered

All role-based permissions from the confirmed spec are already enforced by existing policies:

| Spec rule | Policy | Status |
|---|---|---|
| Owner can edit space settings | [`spaces_update`](supabase/migrations/20260703171000_rls_policies.sql:99) — `is_space_owner(id)` | ✅ Covered |
| Owner can delete space | [`spaces_delete`](supabase/migrations/20260703171000_rls_policies.sql:107) — `is_space_owner(id)` | ✅ Covered |
| Owner can invite | [`space_invitations_insert`](supabase/migrations/20260703171000_rls_policies.sql:185) — `is_space_owner(space_id)` | ✅ Covered |
| Owner can remove members | [`space_members_delete`](supabase/migrations/20260703171000_rls_policies.sql:154) — `is_space_owner(space_id)` | ✅ Covered |
| Member can leave | [`space_members_delete`](supabase/migrations/20260703171000_rls_policies.sql:154) — `OR user_id = auth.uid()` | ✅ Covered |
| Member cannot invite | `space_invitations_insert` requires `is_space_owner` | ✅ Covered |
| Member cannot edit space | `spaces_update` requires `is_space_owner` | ✅ Covered |
| Member cannot delete space | `spaces_delete` requires `is_space_owner` | ✅ Covered |
| Member cannot remove others | `space_members_delete` requires owner OR self | ✅ Covered |
| Owner can edit others' memories | [`memories_update`](supabase/migrations/20260703171000_rls_policies.sql:243) — `is_space_owner(space_id) OR created_by = auth.uid()` | ✅ Covered (Phase 3) |

**Conclusion:** Role-based access control needs **zero policy changes**. The gaps are all in the invitation lifecycle.

## 2.2 Gap 1 — Self-Join Without Invitation Verification (CRITICAL)

**The problem:** The [`space_members_insert`](supabase/migrations/20260703171000_rls_policies.sql:136) policy allows:

```sql
WITH CHECK (
    is_space_owner(space_id)
    OR (user_id = auth.uid() AND role = 'member')
)
```

The second branch lets **any authenticated user insert themselves as `'member'` into any space** — they only need to know the `space_id`. There is no check that a valid, pending, non-expired invitation exists for their email. This is a security hole: it bypasses the entire invitation system.

**Impact:** A user could join any private space without an invitation, violating [`feature-specs.md`](docs/feature-specs.md) §1: *"Users can join only via invitation."*

**Proposed fix:** See [§3.2](#32-rpc-function-accept_space_invitation) — an RPC function `accept_space_invitation(p_token)` that atomically validates the invitation and inserts the membership. The `space_members_insert` policy's self-join branch would then be removed (or tightened to require a valid invitation via a subquery, though the RPC approach is cleaner and avoids race conditions).

## 2.3 Gap 2 — Invitee Cannot Update Invitation Status

**The problem:** The [`space_invitations_update`](supabase/migrations/20260703171000_rls_policies.sql:192) policy only allows space owners:

```sql
USING (is_space_owner(space_id))
WITH CHECK (is_space_owner(space_id))
```

When an invitee accepts an invitation, the invitation's `status` must change from `'pending'` to `'accepted'` and `accepted_at` must be set. But the invitee is not yet a member (hence not an owner), so they cannot update the row.

**Impact:** The acceptance flow cannot mark the invitation as accepted via a standard `supabase.from('space_invitations').update(...)` call.

**Proposed fix:** Handled within the `accept_space_invitation(p_token)` RPC function (SECURITY DEFINER), which bypasses RLS to perform the update atomically. See [§3.2](#32-rpc-function-accept_space_invitation).

## 2.4 Gap 3 — No Duplicate Pending Invite Prevention

**The problem:** There is no UNIQUE constraint on `(space_id, email)` for pending invitations. Two owners (or the same owner twice) could create duplicate pending invitations for the same email in the same space.

**Impact:** Duplicate invitation rows, confusing UX, potential duplicate emails sent.

**Proposed fix:** A partial unique index. See [§3.1](#31-partial-unique-index-on-pending-invitations).

## 2.5 Gap 4 — "Already a Member" Check Requires `auth.users` Access

**The problem:** The spec requires blocking invitations to emails that are already members. To check this, the application must determine whether any `space_members` row for this space has a `user_id` whose email matches the invited email.

Emails live in Supabase's managed `auth.users` table, which is **not accessible via RLS** to other users. The `profiles` table (which IS RLS-accessible) only has `name` and `avatar_url` — no email column. So the client cannot perform this check.

**Impact:** The client cannot prevent inviting an existing member without server-side help.

**Proposed fix:** A BEFORE INSERT trigger on `space_invitations` (SECURITY DEFINER) that checks `auth.users` and raises an exception if the email is already a member. See [§3.3](#33-trigger-check_invitation_not_existing_member).

## 2.6 Gap 5 — Invitee Cannot Decline an Invitation

**The problem:** The spec (Screen 6) asks for a way to see pending invitations. A natural action on that screen is "decline." But the current `space_invitations_update` and `space_invitations_delete` policies only allow space owners. An invitee cannot cancel or decline their own invitation.

**Impact:** Invitees can only ignore invitations, not explicitly decline them. Ignored invitations remain `'pending'` until they expire.

**Proposed fix:** Two options (see [§10](#10-open-questions--conflicts-to-confirm) for the decision):
- **Option A:** Add a `'declined'` status to the CHECK constraint and an RPC function `decline_space_invitation(p_token)`.
- **Option B:** For MVP, don't support explicit decline — invitees simply ignore the invitation and it expires after 7 days. This is simpler and the spec doesn't explicitly require a decline action.

## 2.7 Gap 6 — Invitation Expiry Is Application-Level

**Already documented** in [`backend-implementation.md`](docs/backend-implementation.md) §16.3: the database does not auto-set `status = 'expired'`. The application must check `expires_at < now()` when displaying or accepting invitations.

**No new work needed** — just a reminder that all queries listing pending invitations must filter `expires_at > now()` client-side, and the accept RPC function must check `expires_at > now()` server-side.

## 2.8 Summary — RLS Gap Table

| # | Gap | Severity | Fix |
|---|-----|----------|-----|
| 1 | Self-join without invitation verification | **Critical** | RPC function + remove self-join branch from `space_members_insert` |
| 2 | Invitee cannot update invitation status | **High** | RPC function (SECURITY DEFINER) |
| 3 | No duplicate pending invite prevention | **Medium** | Partial unique index |
| 4 | "Already a member" check needs `auth.users` | **Medium** | BEFORE INSERT trigger (SECURITY DEFINER) |
| 5 | Invitee cannot decline | **Low** | RPC function or defer to post-MVP |
| 6 | Expiry is application-level | **None** (documented) | No fix — application must filter |

---

# 3. Database Changes Required

All changes are **new migrations** — no existing migrations are modified. They follow the existing naming convention (`YYYYMMDDHHMMSS_description.sql`).

## 3.1 Partial Unique Index on Pending Invitations

Prevents duplicate pending invitations for the same `(space_id, email)` pair. Only applies to `status = 'pending'` so that re-inviting after expiry or cancellation is still possible.

```sql
-- Migration: Partial unique index on pending invitations
-- Prevents duplicate pending invites for the same (space_id, email).
-- Only applies to pending status so re-inviting after expiry/cancel is allowed.
CREATE UNIQUE INDEX uq_space_invitations_pending_email
    ON space_invitations (space_id, email)
    WHERE status = 'pending';
```

**RLS interaction:** The client catches the unique violation (PostgreSQL error code `23505`) and maps it to: *"An invitation has already been sent to this email."*

## 3.2 RPC Function: `accept_space_invitation`

A SECURITY DEFINER function that atomically:
1. Looks up the invitation by token.
2. Checks `status = 'pending'` and `expires_at > now()`.
3. Checks the invitee's email (from `auth.jwt()`) matches the invitation's `email`.
4. Checks the invitee is not already a member (defensive — the UNIQUE constraint on `space_members` would catch this too, but a clear error is better).
5. Inserts a `space_members` row with the invitation's `role`.
6. Updates the invitation: `status = 'accepted'`, `accepted_at = now()`.
7. Returns the `space_id` (for client-side navigation).

```sql
-- Migration: accept_space_invitation RPC function
CREATE OR REPLACE FUNCTION accept_space_invitation(p_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invitation space_invitations%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to accept an invitation.'
            USING ERRCODE = 'not_authenticated';
    END IF;

    SELECT * INTO v_invitation
    FROM space_invitations
    WHERE token = p_token
      FOR UPDATE; -- lock the row to prevent race conditions

    IF NOT FOUND THEN
        RAISE EXCEPTION 'This invitation could not be found.'
            USING ERRCODE = 'not_found';
    END IF;

    IF v_invitation.status != 'pending' THEN
        RAISE EXCEPTION 'This invitation has already been used or cancelled.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    IF v_invitation.expires_at <= now() THEN
        -- Mark as expired for cleanliness
        UPDATE space_invitations
        SET status = 'expired'
        WHERE id = v_invitation.id;

        RAISE EXCEPTION 'This invitation has expired.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    IF v_invitation.email != (auth.jwt() ->> 'email') THEN
        RAISE EXCEPTION 'This invitation was sent to a different email address.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Check if already a member (defensive — gives a clearer error than
    -- the UNIQUE constraint violation)
    IF EXISTS (
        SELECT 1 FROM space_members
        WHERE space_id = v_invitation.space_id
          AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'You are already a member of this space.'
            USING ERRCODE = 'unique_violation';
    END IF;

    -- Insert membership
    INSERT INTO space_members (space_id, user_id, role)
    VALUES (v_invitation.space_id, auth.uid(), v_invitation.role);

    -- Mark invitation as accepted
    UPDATE space_invitations
    SET status = 'accepted', accepted_at = now()
    WHERE id = v_invitation.id;

    RETURN v_invitation.space_id;
END;
$$;
```

**Why RPC instead of policy changes:** The acceptance flow requires two operations (insert membership + update invitation) that must be atomic. Doing this via two separate client calls introduces race conditions (double-accept). The RPC function uses `FOR UPDATE` row locking and a single transaction, making it race-safe. It also fills the RLS gaps (Gap 1 and Gap 2) in one place.

**Policy change required:** The `space_members_insert` policy's self-join branch should be removed (or tightened) so that the only way to self-join is through the RPC function:

```sql
-- Tighten space_members_insert: remove the open self-join branch.
-- Self-join now happens only through accept_space_invitation() (SECURITY DEFINER).
CREATE POLICY space_members_insert ON space_members
    FOR INSERT
    TO authenticated
    WITH CHECK (is_space_owner(space_id));
```

> ⚠️ **This modifies an existing policy.** It replaces the `space_members_insert` policy defined in [`20260703171000_rls_policies.sql`](supabase/migrations/20260703171000_rls_policies.sql:136). The new migration uses `DROP POLICY IF EXISTS` + `CREATE POLICY` (the same idempotent pattern as the original). This is the one existing migration's policy that changes — all others remain untouched.

## 3.3 Trigger: `check_invitation_not_existing_member`

A BEFORE INSERT trigger on `space_invitations` that prevents inviting an email that's already a member of the space. It needs `auth.users` access (SECURITY DEFINER) because emails live there.

```sql
-- Migration: Trigger to block inviting existing members
CREATE OR REPLACE FUNCTION check_invitation_not_existing_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM space_members sm
        JOIN auth.users au ON au.id = sm.user_id
        WHERE sm.space_id = NEW.space_id
          AND au.email = NEW.email
    ) THEN
        RAISE EXCEPTION 'This person is already a member of this space.'
            USING ERRCODE = 'unique_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER before_space_invitation_insert
    BEFORE INSERT ON space_invitations
    FOR EACH ROW
    EXECUTE FUNCTION check_invitation_not_existing_member();
```

**Why a trigger instead of an RPC function:** The client still uses a standard `supabase.from('space_invitations').insert(...)` call. The trigger catches the "already a member" case server-side without requiring the client to know about `auth.users`. The client maps the `unique_violation` error code to a clear message.

## 3.4 Optional: `decline_space_invitation` RPC Function

Only needed if we support explicit decline (Gap 5, Option A). See [§10](#10-open-questions--conflicts-to-confirm).

```sql
-- Only if we support explicit decline:
CREATE OR REPLACE FUNCTION decline_space_invitation(p_token uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invitation space_invitations%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to decline an invitation.'
            USING ERRCODE = 'not_authenticated';
    END IF;

    SELECT * INTO v_invitation
    FROM space_invitations
    WHERE token = p_token
      FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'This invitation could not be found.'
            USING ERRCODE = 'not_found';
    END IF;

    IF v_invitation.email != (auth.jwt() ->> 'email') THEN
        RAISE EXCEPTION 'This invitation was sent to a different email address.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_invitation.status != 'pending' THEN
        RETURN; -- idempotent: already accepted/declined/cancelled/expired
    END IF;

    UPDATE space_invitations
    SET status = 'cancelled'
    WHERE id = v_invitation.id;
END;
$$;
```

> Note: This reuses the existing `'cancelled'` status rather than adding a `'declined'` status, to avoid changing the CHECK constraint. The semantic difference (owner-cancelled vs invitee-declined) is not meaningful for MVP.

## 3.5 Migration Summary

| Migration | Type | Purpose |
|---|---|---|
| `YYYYMMDDHHMMSS_invitation_unique_index.sql` | Index | Partial unique index on pending invitations |
| `YYYYMMDDHHMMSS_accept_space_invitation_rpc.sql` | Function + Policy | `accept_space_invitation()` RPC + tighten `space_members_insert` |
| `YYYYMMDDHHMMSS_invitation_member_check_trigger.sql` | Trigger | Block inviting existing members |
| `YYYYMMDDHHMMSS_decline_space_invitation_rpc.sql` *(optional)* | Function | `decline_space_invitation()` RPC |

---

# 4. Data Fetching Strategy

## 4.1 Decision: Plain `useEffect` + `useState` + `supabase-js`

**No React Query.** No new data-fetching library.

**Rationale:**
- [`ai-context.md`](docs/ai-context.md) §4: *"AI assistants should not introduce new frameworks, libraries, state management solutions, UI kits, or major dependencies unless explicitly requested."*
- [`ai-context.md`](docs/ai-context.md) §8: *"Keep state as local as possible. Do not introduce a global state management library unless explicitly approved."*
- The existing [`AuthProvider`](app/avero/src/context/AuthProvider.tsx) establishes the pattern: plain `useEffect` + `useState` + direct `supabase-js` calls. No React Query is in [`package.json`](app/avero/package.json).
- [`ai-context.md`](docs/ai-context.md) §3: *"Consistency Over Personal Preference — Follow the existing architecture."*

## 4.2 Pattern

Each page that needs data fetches it in a `useEffect` on mount, stores it in local `useState`, and exposes `isLoading` / `error` / `data` states. This mirrors how [`AuthProvider`](app/avero/src/context/AuthProvider.tsx) works.

```typescript
// Example pattern (not implementation — just illustrating the approach):
const [spaces, setSpaces] = useState<Space[]>([]);
const [isLoading, setIsLoading] = useState(true);
const [error, setError] = useState<string | undefined>(undefined);

useEffect(() => {
  async function fetchSpaces() {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("space_members")
      .select("*, spaces(*)")
      .eq("user_id", user.id);

    if (error) {
      setError("Something went wrong. Please try again.");
    } else {
      setSpaces(data.map((sm) => sm.spaces));
    }
    setIsLoading(false);
  }
  fetchSpaces();
}, [user.id]);
```

## 4.3 Optional Custom Hooks

If data-fetching logic is reused across pages (e.g., the spaces list is needed in both the dashboard and the sidebar), extract it into a custom hook per [`ai-context.md`](docs/ai-context.md) §8. These are **optional** — only create them if the logic is genuinely shared:

- `useSpaces()` — fetch the current user's spaces (used by dashboard + potentially a sidebar).
- `useSpaceMembers(spaceId)` — fetch a space's members (used by space detail).
- `usePendingInvitations()` — fetch invitations waiting for the current user (used by dashboard banner + invitations page).

If only used in one place, keep the fetching logic inline in the page component.

## 4.4 Cache Invalidation

Without React Query, cache invalidation is manual. After a mutation (create space, accept invite, leave space), the page re-fetches the relevant data by calling the fetch function again. This is simple and sufficient for MVP — Spaces lists are small and infrequently changed.

---

# 5. Component & Page Structure

## 5.1 Layout: New `AppShell` Component

The auth screens use [`AuthShell`](app/avero/src/components/auth/AuthShell.tsx) — a two-panel ambient layout designed for the unauthenticated threshold experience. Spaces is the **authenticated area** and needs a fundamentally different layout:

- A top bar with the wordmark, user identity, and sign-out action.
- A content area that is centered and width-constrained (per [`design-system.md`](docs/design-system.md) §5: *"Max width for content areas"*).
- Responsive: mobile single-column, desktop centered with comfortable max width.

**`AuthShell` is NOT reused** for Spaces. Per [`auth-design.md`](docs/auth-design.md) §5: *"Only `AuthShell` and `AuthFormPanel` are auth-specific, because the two-panel ambient frame is unique to this experience."* The inverse is also true — the authenticated area has its own frame.

**New component:** `app/avero/src/components/AppShell.tsx`

```
AppShell
├── TopBar (wordmark, user menu, sign-out)
└── Content (centered, max-width constrained)
    └── {children}
```

## 5.2 Reused UI Components

These existing components are reused directly in Spaces screens, per [`ai-context.md`](docs/ai-context.md) §3 (*Reuse Before Creating*):

| Component | Used For |
|---|---|
| [`TextField`](app/avero/src/components/ui/TextField.tsx) | Space name, description, invite email inputs |
| [`PrimaryButton`](app/avero/src/components/ui/PrimaryButton.tsx) | Create space, send invite, accept invite actions |
| [`GhostLink`](app/avero/src/components/ui/GhostLink.tsx) | Navigation links (back to dashboard, sign in, sign up) |
| [`Spinner`](app/avero/src/components/ui/Spinner.tsx) | Loading states |
| [`BrandWordmark`](app/avero/src/components/auth/BrandWordmark.tsx) | AppShell top bar |
| [`AuthLoadingScreen`](app/avero/src/components/auth/AuthLoadingScreen.tsx) | Initial session resolution (already used by route guards) |

## 5.3 New Shared Components

These are new components justified by genuinely different UI patterns in Spaces:

| Component | Purpose | Justification |
|---|---|---|
| `AppShell` | Authenticated area layout | Different from `AuthShell` — no ambient panel, has a top bar |
| `SpaceCard` | Display a space in the dashboard list | [`design-system.md`](docs/design-system.md) §6 mentions Cards for Spaces |
| `EmptyState` | Inspiring empty state for no-spaces | [`blueprint.md`](docs/blueprint.md) §6: *"Empty States Should Inspire"* |
| `ConfirmDialog` | Destructive action confirmation | Delete space, leave space, remove member — need confirmation |
| `MemberRow` | Display a member in the member list | Space detail member list |
| `InviteRow` | Display a pending invite in the list | Space detail (sent invites) + invitations page (received invites) |

> `ConfirmDialog` is the one component that may warrant extraction into a generic `Modal`/`Dialog` later. For MVP, a focused `ConfirmDialog` is simpler and sufficient.

## 5.4 New Pages

| Page | Route | Purpose |
|---|---|---|
| `SpacesDashboardPage` | `/spaces` | List of user's spaces + pending invites banner (Screen 1) |
| `CreateSpacePage` | `/spaces/new` | Create space form (Screen 2) |
| `SpaceDetailPage` | `/spaces/:spaceId` | Space settings, member list, invite/leave/delete actions (Screen 3 + 4) |
| `AcceptInvitePage` | `/invite/:token` | Accept invitation flow (Screen 5) |
| `InvitationsPage` | `/invitations` | Pending invitations waiting for the user (Screen 6) |

## 5.5 New Types

Co-located with the pages that use them (or in a `types/` directory if shared):

```typescript
type Space = {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type SpaceMember = {
  id: string;
  space_id: string;
  user_id: string;
  role: "owner" | "member";
  joined_at: string;
  // Joined with profiles:
  profiles?: { name: string; avatar_url: string | null };
};

type SpaceInvitation = {
  id: string;
  space_id: string;
  email: string;
  invited_by: string | null;
  role: "owner" | "member";
  token: string;
  status: "pending" | "accepted" | "expired" | "cancelled";
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
};
```

---

# 6. Screen-by-Screen Design

## 6.1 Screen 1 — Spaces Dashboard (`/spaces`)

**Replaces** [`SpacesPlaceholderPage.tsx`](app/avero/src/pages/SpacesPlaceholderPage.tsx).

**Layout:** `AppShell` wrapping a centered content area.

**Content:**
- **Heading:** *"Your Spaces"* (H1, emotional per [`design-system.md`](docs/design-system.md) §3).
- **Primary action:** *"Create a Space"* button (links to `/spaces/new`).
- **Pending invites banner** (if the user has pending invitations): *"You have N pending invitation(s). View them →"* linking to `/invitations`.
- **Space list:** `SpaceCard` components for each space the user belongs to. Each card shows the space name, description (if any), member count, and the user's role badge.
- **Empty state:** If the user has no spaces, show an inspiring empty state per [`blueprint.md`](docs/blueprint.md) §6: *"An empty Avero is the beginning of a story, not an error."* Copy: *"Your first Space is where your shared story begins. Create one, or accept an invitation to join one."* with a *"Create a Space"* primary action.

**Data fetched:**
- User's spaces: `space_members` joined with `spaces` (filtered by `user_id`).
- Pending invitations count: `space_invitations` where `email = user.email` and `status = 'pending'` and `expires_at > now()`.

**Post-auth routing** (per [`auth-design.md`](docs/auth-design.md) §3.6):
- Returning user with Spaces → this dashboard.
- New user with no Spaces → this dashboard showing the empty state.
- Returning user with exactly one Space → **deferred** (always show dashboard for MVP; auto-redirect to single space is a future enhancement).

## 6.2 Screen 2 — Create Space (`/spaces/new`)

**Layout:** `AppShell` wrapping a centered form (similar width to `AuthFormPanel`'s ~420px).

**Content:**
- **Heading:** *"Create a Space"* with supporting line *"A private home for your shared memories."*
- **Form:**
  - `TextField` for name (required, label "Space name").
  - `TextField` for description (optional, label "Description", multiline or single-line).
  - `PrimaryButton` *"Create Space"*.
- **Secondary action:** `GhostLink` *"Back to Spaces"*.

**On success:** Navigate to `/spaces/:spaceId` (the newly created space's detail page).

**Supabase call:** `supabase.from('spaces').insert({ name, description, created_by: user.id }).select().single()`. The [`handle_new_space()`](supabase/migrations/20260703170400_trigger_functions.sql:106) trigger auto-adds the creator as owner.

## 6.3 Screen 3 — Space Detail / Settings (`/spaces/:spaceId`)

**Layout:** `AppShell` wrapping a centered content area.

**Content:**
- **Space header:** Name (H1), description (if any).
- **Edit button** (owners only): Opens an inline edit form or navigates to an edit mode for name/description.
- **Member list:** `MemberRow` for each member, showing name, role badge, and actions.
  - **Owner actions on members:** Remove member (with `ConfirmDialog`), except for self (self = leave, not remove).
  - **Member self-action:** Leave space (with `ConfirmDialog`).
- **Invite button** (owners only): Links to `/spaces/:spaceId/invite` or opens an invite section inline. See Screen 4.
- **Pending invites list** (owners only): `InviteRow` for each pending invitation, showing email, sent date, expiry, and a cancel button.
- **Delete space button** (owners only): With `ConfirmDialog` requiring typed confirmation of the space name (destructive action).

**Data fetched:**
- Space details: `spaces` by id.
- Members: `space_members` joined with `profiles` by `space_id`.
- Pending invitations: `space_invitations` by `space_id` where `status = 'pending'`.

**Role-based rendering:** The page checks the current user's role (from the `space_members` query) and conditionally renders owner-only UI. RLS provides the security guarantee; the UI just hides unavailable actions.

## 6.4 Screen 4 — Send Invite UI

**Implementation:** Embedded within `SpaceDetailPage` (not a separate route) — an invite section that owners can expand.

**Content:**
- `TextField` for email input (label "Invite by email").
- `PrimaryButton` *"Send invite"*.
- **Pending invites list:** `InviteRow` for each pending invitation, showing:
  - Invitee email.
  - Sent date.
  - Expiry date (with "expires in N days" or "expired" indicator).
  - Cancel button (sets `status = 'cancelled'` — owner can do this via existing `space_invitations_update` policy).

**Validation:**
- Email format check (same lightweight regex as auth pages).
- Client-side check for duplicate pending invite (query existing pending invites for this space + email before submitting — the partial unique index is the server-side backstop).
- Server-side "already a member" check via the trigger ([§3.3](#33-trigger-check_invitation_not_existing_member)).

**Error mapping:**
- `23505` (unique violation) from the partial index → *"An invitation has already been sent to this email."*
- `unique_violation` from the trigger → *"This person is already a member of this space."*

## 6.5 Screen 5 — Accept Invite (`/invite/:token`)

**Route type:** Public (not wrapped in `ProtectedRoute`) — the invitee may not have an account yet. Similar to `verify-email` and `reset-password`.

**Two cases:**

### Case (a) — Invitee is logged in

**Content:**
- **Heading:** *"You've been invited"* with supporting line naming the space (fetched via the invitation).
- Space name and description.
- Inviter name (if `invited_by` is not null; otherwise *"A member of this space"*).
- `PrimaryButton` *"Accept invitation"*.
- `GhostLink` *"Back to Spaces"* (declines implicitly by navigating away).

**On accept:** Call `supabase.rpc('accept_space_invitation', { p_token: token })`. On success, navigate to `/spaces/:spaceId`.

### Case (b) — Invitee is not logged in (no account or not signed in)

**Content:**
- **Heading:** *"You've been invited to join a Space on Avero."*
- **Supporting line:** *"Sign in or create an account to accept your invitation."*
- `PrimaryButton` *"Sign in"* → navigates to `/signin` (with redirect back to `/invite/:token`).
- `GhostLink` *"Create an account"* → navigates to `/signup` (with redirect back to `/invite/:token`).

**After sign-in:** The user is redirected back to `/invite/:token`, which now shows Case (a).

**After sign-up + verification:** The user signs in and lands on the Spaces dashboard, which shows the *"You have N pending invitations"* banner. The user can accept from `/invitations` or by clicking the original email link again. See [§8.6](#86-auto-attach-after-signup) for the full auto-attach flow.

**Token lookup:** The page queries `space_invitations` by token. RLS allows this if the user is logged in and their email matches (`email = (auth.jwt() ->> 'email')`). If not logged in, the page cannot look up the invitation details — it shows the generic Case (b) message without revealing the space name. This is acceptable: the email itself told the invitee which space they were invited to.

> ⚠️ **Conflict with existing auth flow:** The current [`VerifyEmailPage`](app/avero/src/pages/VerifyEmailPage.tsx) signs the user out after verification and redirects to `/signin`. This means the invite redirect-through-verification flow doesn't work seamlessly. See [§10.2](#102-verifyemailpage-signs-out-after-verification) for the proposed resolution.

## 6.6 Screen 6 — Pending Invitations (`/invitations`)

**Layout:** `AppShell` wrapping a centered content area.

**Content:**
- **Heading:** *"Pending invitations"* with supporting line *"Spaces you've been invited to join."*
- **Invitation list:** `InviteRow` for each pending invitation, showing:
  - Space name (joined from `spaces`).
  - Inviter name (if available).
  - Sent date and expiry.
  - `PrimaryButton` *"Accept"*.
  - `GhostLink` *"Decline"* (if we implement decline — see [§10.1](#101-should-invitees-be-able-to-explicitly-decline-invitations)).
- **Empty state:** *"No pending invitations. When someone invites you to a Space, it'll appear here."*

**Data fetched:** `space_invitations` where `email = user.email` and `status = 'pending'` and `expires_at > now()`, joined with `spaces` for space names.

---

# 7. Exact Supabase Calls per Flow

## 7.1 Spaces Dashboard

```typescript
// Fetch user's spaces (RLS auto-filters to spaces they're a member of)
const { data, error } = await supabase
  .from("space_members")
  .select("*, spaces(*)")
  .eq("user_id", user.id);

// Fetch pending invitation count for the banner
const { count, error } = await supabase
  .from("space_invitations")
  .select("*", { count: "exact", head: true })
  .eq("email", user.email)
  .eq("status", "pending")
  .gt("expires_at", new Date().toISOString());
```

## 7.2 Create Space

```typescript
// Insert space — handle_new_space trigger auto-adds creator as owner
const { data, error } = await supabase
  .from("spaces")
  .insert({
    name: name.trim(),
    description: description.trim() || null,
    created_by: user.id,
  })
  .select()
  .single();
// data.id is the new space's ID — navigate to /spaces/:id
```

## 7.3 Space Detail

```typescript
// Fetch space details (RLS auto-filters — non-members get no rows)
const { data: space } = await supabase
  .from("spaces")
  .select("*")
  .eq("id", spaceId)
  .single();

// Fetch members with their profiles
const { data: members } = await supabase
  .from("space_members")
  .select("*, profiles(name, avatar_url)")
  .eq("space_id", spaceId)
  .order("joined_at", { ascending: true });

// Fetch pending invitations (owner-only — RLS enforces)
const { data: invitations } = await supabase
  .from("space_invitations")
  .select("*")
  .eq("space_id", spaceId)
  .eq("status", "pending")
  .order("created_at", { ascending: false });

// Update space (owner-only — RLS enforces)
await supabase
  .from("spaces")
  .update({ name: newName.trim(), description: newDescription.trim() || null })
  .eq("id", spaceId);

// Delete space (owner-only — RLS enforces, cascades to all child data)
await supabase.from("spaces").delete().eq("id", spaceId);

// Leave space (self-delete — RLS allows user_id = auth.uid())
await supabase
  .from("space_members")
  .delete()
  .eq("space_id", spaceId)
  .eq("user_id", user.id);

// Remove member (owner-only — RLS enforces)
await supabase
  .from("space_members")
  .delete()
  .eq("space_id", spaceId)
  .eq("user_id", targetUserId);
```

## 7.4 Send Invite

```typescript
// Insert invitation (owner-only — RLS enforces via space_invitations_insert)
// The check_invitation_not_existing_member trigger blocks existing members.
// The partial unique index blocks duplicate pending invites.
const { data, error } = await supabase
  .from("space_invitations")
  .insert({
    space_id: spaceId,
    email: email.trim(),
    invited_by: user.id,
    role: "member", // always 'member' for Phase 2
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })
  .select()
  .single();

// Cancel invitation (owner-only — RLS enforces)
await supabase
  .from("space_invitations")
  .update({ status: "cancelled" })
  .eq("id", invitationId);
```

## 7.5 Accept Invite

```typescript
// RPC function — atomically validates + inserts membership + updates status
const { data: spaceId, error } = await supabase.rpc("accept_space_invitation", {
  p_token: token,
});
// Navigate to /spaces/:spaceId on success
```

## 7.6 Pending Invitations (for user)

```typescript
// Fetch invitations for the current user's email (RLS allows email match)
const { data, error } = await supabase
  .from("space_invitations")
  .select("*, spaces(name, description)")
  .eq("email", user.email)
  .eq("status", "pending")
  .gt("expires_at", new Date().toISOString())
  .order("created_at", { ascending: false });
```

---

# 8. Edge Cases & Handling

## 8.1 Duplicate Invites

**Scenario:** Owner invites the same email twice to the same space while the first invite is still pending.

**Handling:**
- **Server-side:** The partial unique index `uq_space_invitations_pending_email` on `(space_id, email) WHERE status = 'pending'` prevents the second insert. PostgreSQL raises error code `23505`.
- **Client-side:** The client catches the error and shows *"An invitation has already been sent to this email."*
- **Re-inviting after expiry/cancellation:** Allowed — the partial index only covers `status = 'pending'`. A new invitation can be created after the previous one expires or is cancelled.

## 8.2 Expired Invites

**Scenario:** An invitee tries to accept an invitation past its `expires_at`.

**Handling:**
- **Server-side:** The `accept_space_invitation` RPC function checks `expires_at <= now()` and raises an exception. It also marks the invitation as `'expired'` for data cleanliness.
- **Client-side:** The `AcceptInvitePage` shows a calm error: *"This invitation has expired. Ask the space owner to send a new one."*
- **Listing:** Queries listing pending invitations filter `expires_at > now()` so expired invites don't appear in the user's pending list.

## 8.3 Last-Owner-Leaving Scenario

**Scenario:** The only owner of a space tries to leave (or is removed, though only self can leave — owners can't remove other owners without the application checking).

**Handling:**
- This is **not enforced at the database level** — the `space_members_delete` policy allows `user_id = auth.uid()` (self-leave) regardless of role. An owner CAN delete their own membership.
- **Application-level check (required):** Before allowing leave, the client counts owners in the space. If the current user is the only owner, block the leave with: *"You're the only owner of this Space. Transfer ownership to another member or delete the Space before leaving."*
- **Optional DB safety net:** A BEFORE DELETE trigger on `space_members` that checks if the member is an owner and is the last owner, and raises an exception. This is recommended as a defense-in-depth measure but is not strictly required if the application check is reliable.
- **Per [`backend-implementation.md`](docs/backend-implementation.md) §16.1:** *"This is an application-level concern, not a database constraint."*

> ⚠️ **Note:** The spec asks "last-owner-leaving scenario if that's even possible." With the current RLS policies, it IS possible — an owner can leave (self-delete their membership). The application must prevent it. See [§10.3](#103-should-we-add-a-db-trigger-to-prevent-last-owner-leaving) for the decision on whether to add a DB trigger as a safety net.

## 8.4 Inviting Owner Removed or Leaves

**Scenario:** Owner A invites email X. Later, Owner A leaves the space (or is removed by another owner, or deletes their account). The invitation is still pending.

**Proposed handling (safest option):** **The invitation remains honorable.**

**Rationale:**
- The invitation belongs to the **Space**, not to the inviter personally (per [`backend-implementation.md`](docs/backend-implementation.md) §7.3: *"An invitation belongs to the Space, not to the inviter personally."*).
- `space_invitations.invited_by` uses `ON DELETE SET NULL` — if the inviter deletes their account, the invitation survives with `invited_by = NULL`.
- If the inviter leaves the space (membership deleted), `invited_by` still points to their `profiles.id` (which still exists — leaving a space doesn't delete your account). The invitation is still valid.
- Other owners can still manage the space and the invitation.
- The invitee shouldn't be penalized for the inviter's departure.

**This is the safest option** because:
1. It doesn't break the invitee's experience due to actions outside their control.
2. The Space still exists and has other owners who can manage it.
3. Invalidating the invite would require either a trigger on `space_members` DELETE (complex) or application-level cleanup (error-prone).
4. The invitation's 7-day expiry is the natural cleanup mechanism.

**If the inviter is the LAST owner leaving:** The last-owner-leaving check ([§8.3](#83-last-owner-leaving-scenario)) prevents this scenario — the last owner cannot leave. So there will always be at least one owner to manage the space.

## 8.5 Space Deleted with Pending Invites

**Scenario:** A space is deleted while it has pending invitations.

**Handling:**
- `space_invitations.space_id` uses `ON DELETE CASCADE` (per [`backend-implementation.md`](docs/backend-implementation.md) §7.1). When the space is deleted, all invitations are automatically deleted.
- If an invitee clicks the email link after the space is deleted, the `accept_space_invitation` RPC function finds no invitation (it was cascade-deleted) and raises `'not_found'`.
- The `AcceptInvitePage` shows: *"This invitation is no longer available. The Space may have been deleted."*

**No additional work needed** — the CASCADE behavior handles this automatically.

## 8.6 Auto-Attach After Signup

**Scenario:** Owner invites email X. Person with email X has no Avero account. They sign up, verify their email, and sign in.

**Handling:**
1. The invitation persists in `space_invitations` with `status = 'pending'`.
2. After the person signs up and verifies their email, they sign in.
3. The Spaces dashboard queries `space_invitations` where `email = user.email` and `status = 'pending'` and `expires_at > now()`.
4. If invitations are found, the dashboard shows the *"You have N pending invitations"* banner.
5. The user navigates to `/invitations` and accepts the invitation(s).

**"Auto-attach" means "auto-discover"** — the invitation is automatically visible to the user after they sign in, because the RLS SELECT policy on `space_invitations` matches by email (`email = (auth.jwt() ->> 'email')`). The user still explicitly accepts; we don't auto-add them without consent.

**No additional database work needed** — the existing RLS policy and the dashboard's invitation check handle this.

## 8.7 Member Leaving vs Being Removed

| Action | Who initiates | Supabase call | RLS policy |
|---|---|---|---|
| Leave | The member themselves | `delete().eq('user_id', user.id)` | `user_id = auth.uid()` |
| Remove | A space owner | `delete().eq('user_id', targetUserId)` | `is_space_owner(space_id)` |

Both use the same `space_members_delete` policy. The difference is UX (who clicks the button), not data model. The application checks the last-owner scenario only for leave (an owner removing another owner is also subject to the last-owner check).

## 8.8 Owner Removing Another Owner

**Scenario:** Owner A removes Owner B from the space.

**Handling:**
- The `space_members_delete` policy allows `is_space_owner(space_id)` — so Owner A can remove Owner B.
- **Application-level check:** Before removing an owner, check if they're the last owner. If so, block with: *"This is the last owner of the Space. You cannot remove them without transferring ownership or deleting the Space."*
- This is the same check as the last-owner-leaving scenario ([§8.3](#83-last-owner-leaving-scenario)).

## 8.9 Already a Member Tries to Accept

**Scenario:** A user who is already a member of a space tries to accept an invitation to it (e.g., they were invited, joined via another path, and then clicked the old invite link).

**Handling:**
- The `accept_space_invitation` RPC function checks `EXISTS` in `space_members` and raises: *"You are already a member of this space."*
- The client shows this message and navigates to the space.

## 8.10 Invitee Email Mismatch

**Scenario:** User A tries to accept an invitation that was sent to User B's email (e.g., they somehow got the token).

**Handling:**
- The `accept_space_invitation` RPC function checks `v_invitation.email != (auth.jwt() ->> 'email')` and raises: *"This invitation was sent to a different email address."*
- The client shows this message.

---

# 9. Existing Code Touched vs Net-New

## 9.1 Existing Code Touched

| File | Change | Reason |
|---|---|---|
| [`routes.ts`](app/avero/src/constants/routes.ts) | Add new route constants | `SPACE_CREATE_PATH`, `SPACE_DETAIL_PATH`, `INVITE_ACCEPT_PATH`, `INVITATIONS_PATH` |
| [`App.tsx`](app/avero/src/App.tsx) | Add new routes, replace placeholder | Replace `SpacesPlaceholderPage` with `SpacesDashboardPage`; add routes for create, detail, accept invite, invitations |
| [`SpacesPlaceholderPage.tsx`](app/avero/src/pages/SpacesPlaceholderPage.tsx) | Delete or replace | Replaced by `SpacesDashboardPage` |
| [`SignInPage.tsx`](app/avero/src/pages/SignInPage.tsx) | Add redirect parameter support | Support `?redirect=/invite/:token` so invitees return to the accept page after sign-in |
| [`SignUpPage.tsx`](app/avero/src/pages/SignUpPage.tsx) | Add redirect parameter support | Support `?redirect=/invite/:token` so invitees return to the accept page after sign-up + verification |
| [`VerifyEmailPage.tsx`](app/avero/src/pages/VerifyEmailPage.tsx) | Conditional redirect | If a redirect target exists, don't sign out — redirect to the target instead of `/signin`. See [§10.2](#102-verifyemailpage-signs-out-after-verification). |

## 9.2 Net-New Code

### Database (new migrations)

| File | Purpose |
|---|---|
| `supabase/migrations/YYYYMMDDHHMMSS_invitation_unique_index.sql` | Partial unique index on pending invitations |
| `supabase/migrations/YYYYMMDDHHMMSS_accept_space_invitation_rpc.sql` | `accept_space_invitation()` RPC + tighten `space_members_insert` policy |
| `supabase/migrations/YYYYMMDDHHMMSS_invitation_member_check_trigger.sql` | Trigger to block inviting existing members |
| `supabase/migrations/YYYYMMDDHHMMSS_decline_space_invitation_rpc.sql` *(optional)* | `decline_space_invitation()` RPC |

### Frontend — Components

| File | Purpose |
|---|---|
| `app/avero/src/components/AppShell.tsx` | Authenticated area layout (top bar + content) |
| `app/avero/src/components/spaces/SpaceCard.tsx` | Space card for dashboard list |
| `app/avero/src/components/spaces/EmptyState.tsx` | Inspiring empty state for no-spaces |
| `app/avero/src/components/spaces/MemberRow.tsx` | Member row in member list |
| `app/avero/src/components/spaces/InviteRow.tsx` | Invite row in invite lists |
| `app/avero/src/components/ui/ConfirmDialog.tsx` | Confirmation dialog for destructive actions |

### Frontend — Pages

| File | Purpose |
|---|---|
| `app/avero/src/pages/SpacesDashboardPage.tsx` | Spaces dashboard (Screen 1) |
| `app/avero/src/pages/CreateSpacePage.tsx` | Create space form (Screen 2) |
| `app/avero/src/pages/SpaceDetailPage.tsx` | Space detail/settings (Screen 3 + 4) |
| `app/avero/src/pages/AcceptInvitePage.tsx` | Accept invite flow (Screen 5) |
| `app/avero/src/pages/InvitationsPage.tsx` | Pending invitations (Screen 6) |

### Frontend — Types

| File | Purpose |
|---|---|
| `app/avero/src/types/space.ts` *(or co-located)* | `Space`, `SpaceMember`, `SpaceInvitation` types |

### Frontend — Hooks (optional, only if logic is shared)

| File | Purpose |
|---|---|
| `app/avero/src/hooks/useSpaces.ts` | Fetch user's spaces |
| `app/avero/src/hooks/usePendingInvitations.ts` | Fetch user's pending invitations |

---

# 10. Open Questions & Conflicts to Confirm

## 10.1 Should invitees be able to explicitly decline invitations?

**Current state:** The spec (Screen 6) asks for "a way to see pending invites." It doesn't explicitly require a decline action.

**Options:**
- **Option A (simpler, recommended for MVP):** No explicit decline. Invitees ignore invitations; they expire after 7 days. The invitations page only has an "Accept" button. This avoids a new RPC function and status change.
- **Option B:** Add a `decline_space_invitation()` RPC function and a "Decline" button. The invitation status changes to `'cancelled'`. This gives the invitee agency and cleans up the invitation immediately.

**Recommendation:** Option A for MVP. The 7-day expiry is sufficient cleanup. Decline can be added post-MVP if users request it.

## 10.2 `VerifyEmailPage` signs out after verification

**Conflict:** The current [`VerifyEmailPage`](app/avero/src/pages/VerifyEmailPage.tsx) signs out the verification session and redirects to `/signin`. This means if a user signs up from an invite link (`/signup?redirect=/invite/:token`), after verification they're signed out and land on sign-in — not on the accept invite page.

**Proposed resolution:** Modify `VerifyEmailPage` to check for a redirect target. If one exists:
- Don't sign out the verification session.
- Redirect to the target (`/invite/:token`) after the success delay.
- The `AcceptInvitePage` then shows the invitation details (the user is now logged in with a verified email that matches the invitation).

If no redirect target exists, keep the current behavior (sign out + redirect to sign-in).

**Alternative:** Don't modify `VerifyEmailPage`. Instead, after the user signs in (post-verification), the Spaces dashboard shows the pending invitations banner, and the user accepts from there. This is simpler but less seamless — the user doesn't end up on the accept page directly.

**Recommendation:** The alternative (don't modify `VerifyEmailPage`). The auto-attach flow via the dashboard banner is sufficient for MVP and avoids touching the auth flow. The invite email link still works — the user just accepts from the invitations page instead of directly from the link.

## 10.3 Should we add a DB trigger to prevent last-owner-leaving?

**Current state:** [`backend-implementation.md`](docs/backend-implementation.md) §16.1 says this is an application-level concern. The application checks before allowing leave.

**Options:**
- **Option A (application-level only):** The client checks the owner count before allowing leave. If the user is the last owner, block with an error. Simple, but a bug in the client could allow it.
- **Option B (DB trigger + application-level):** Add a BEFORE DELETE trigger on `space_members` that raises an exception if the member is an owner and no other owners exist. This is a defense-in-depth safety net.

**Recommendation:** Option A for MVP (aligns with §16.1). Option B can be added later if defense-in-depth is desired. The application check is straightforward and reliable for a single-client MVP.

## 10.4 Should the "exactly one Space" auto-redirect be implemented?

[`auth-design.md`](docs/auth-design.md) §3.6 mentions: *"Returning user with exactly one Space → may route directly into that Space."*

**Recommendation:** Defer to post-MVP. Always show the dashboard. Auto-redirecting to a single space could be confusing (the user doesn't see their list or the create button). The dashboard with one space card is clear and simple.

## 10.5 Should the invite email link use a token in the URL path or query string?

**Options:**
- `/invite/:token` (path parameter) — cleaner URL, standard RESTful pattern.
- `/invite?token=xxx` (query parameter) — easier to parse, doesn't require a route parameter.

**Recommendation:** Path parameter (`/invite/:token`) — consistent with RESTful routing and React Router patterns. The token is a UUID, so it's URL-safe.

## 10.6 Should we send invitation emails via Supabase Auth or a custom email service?

**Current state:** The spec says "invite by email." Sending the invitation email (with the accept link) is not covered by the existing RLS or schema — it's an application/infrastructure concern.

**Options:**
- **Supabase Edge Function:** Send the email via a Supabase Edge Function that uses an email service (Resend, SendGrid, etc.). The client calls the Edge Function after creating the invitation.
- **Client-side email:** Not possible — browsers can't send email directly.
- **Supabase Auth admin API:** Not designed for custom invitation emails.

**Recommendation:** This is out of scope for the design doc but needs to be decided before implementation. A Supabase Edge Function + email service (e.g., Resend) is the standard approach. For local development/testing, the invitation link can be displayed in the UI instead of emailed.

## 10.7 Should `space_invitations.role` always be `'member'` for Phase 2?

**Current state:** The `space_invitations.role` column allows `'owner'` or `'member'`. The spec says owners invite members — there's no mention of inviting someone as an owner.

**Recommendation:** Yes — all Phase 2 invitations use `role = 'member'`. The `role` column on invitations is set to `'member'` by default (per the schema). Inviting as `'owner'` (owner transfer/promotion) is a future feature, not Phase 2 scope. The UI doesn't expose a role selector.

## 10.8 Conflict: `space_members_insert` policy modification

The proposed fix for Gap 1 ([§2.2](#22-gap-1--self-join-without-invitation-verification-critical)) modifies the existing `space_members_insert` policy by removing the self-join branch. This is the **only existing policy that changes** — all other 36 policies remain untouched.

This is necessary for security. The self-join branch is a hole that allows any authenticated user to join any space. The `accept_space_invitation` RPC function replaces it with a secure, invitation-verified path.

**Confirm:** Is modifying this one existing policy acceptable, or should we find an alternative approach (e.g., a more complex WITH CHECK that verifies an invitation exists)?

---

## Document Status

**Version:** 0.1 (Draft)

**Status:** 🟡 In Review — awaiting confirmation on [§10](#10-open-questions--conflicts-to-confirm) before implementation begins.

**Next Steps:** Confirm the open questions, then proceed to implementation following the migration + component + page order defined in [§9](#9-existing-code-touched-vs-net-new).
