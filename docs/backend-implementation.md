# Avero Backend Implementation Blueprint

**Version:** 1.0

**Status:** 🟢 Approved

**Scope:** Database architecture, schema design, Row Level Security, and Supabase Storage strategy for the Avero MVP.

**Aligned with:** [`blueprint.md`](docs/blueprint.md), [`feature-specs.md`](docs/feature-specs.md), [`database.md`](docs/database.md), [`ai-context.md`](docs/ai-context.md), [`auth-design.md`](docs/auth-design.md), [`roadmap.md`](docs/roadmap.md).

**Backend:** Supabase (PostgreSQL + Supabase Auth + Supabase Storage) per [`ai-context.md`](docs/ai-context.md) §4.

> This document is the single source of truth for database implementation. It supersedes [`database.md`](docs/database.md) where the two conflict, and documents every assumption, decision, and caveat discovered during architecture planning. No SQL or migrations are included — this is a structural blueprint only.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Documentation Gaps & Assumptions](#2-documentation-gaps--assumptions)
3. [Final Decisions Summary](#3-final-decisions-summary)
4. [Complete Table Inventory](#4-complete-table-inventory)
5. [Table Specifications](#5-table-specifications)
6. [Relationships](#6-relationships)
7. [Foreign Keys & Cascade Behavior](#7-foreign-keys--cascade-behavior)
8. [Soft Delete vs Hard Delete](#8-soft-delete-vs-hard-delete)
9. [Timestamp Strategy](#9-timestamp-strategy)
10. [Indexes](#10-indexes)
11. [Row Level Security Strategy](#11-row-level-security-strategy)
12. [Triggers & Functions](#12-triggers--functions)
13. [Supabase Storage Strategy](#13-supabase-storage-strategy)
14. [Implementation Order](#14-implementation-order)
15. [Future Scalability Considerations](#15-future-scalability-considerations)
16. [Important Notes & Caveats](#16-important-notes--caveats)

---

# 1. Design Philosophy

The Avero database is built around one core idea from [`database.md`](docs/database.md) §1:

> Everything exists to preserve shared memories inside Spaces.

The architecture prioritizes:

- **Data integrity** — no lost memories ([`blueprint.md`](docs/blueprint.md) §7: *"Losing a Memory is far worse than delaying a feature"*).
- **Privacy by default** — no data is accessible without Space membership ([`feature-specs.md`](docs/feature-specs.md) §9: *"If you are not in the Space, you cannot see anything inside it. No exceptions in MVP."*).
- **Strong relationships** — referential integrity enforced at the database level.
- **Simplicity** — no premature abstraction, no features beyond MVP scope ([`blueprint.md`](docs/blueprint.md) §8).

---

# 2. Documentation Gaps & Assumptions

[`database.md`](docs/database.md) defines 9 entities but is incomplete in several areas critical to the MVP. The following gaps were identified and resolved with documented assumptions.

### Gap 1 — No `profiles` table (Supabase Auth integration)

[`database.md`](docs/database.md) §3 lists a "Users" entity with `password_hash` / `auth_provider_id`. Since Avero uses Supabase Auth ([`ai-context.md`](docs/ai-context.md) §10), authentication lives in Supabase's managed `auth.users` table.

**Assumption:** A `profiles` table mirrors `auth.users.id` and stores app-level user data (`name`, `avatar_url`). A database trigger on `auth.users INSERT` creates the matching `profiles` row, copying `name` from `user_metadata`. This aligns with the existing [`SignUpPage.tsx`](app/avero/src/pages/SignUpPage.tsx) which already stores `name` in `user_metadata`.

### Gap 2 — No `space_invitations` table

[`feature-specs.md`](docs/feature-specs.md) §1 states: *"Users can join only via invitation. Invalid or expired invites are rejected."* [`database.md`](docs/database.md) has no invitation table.

**Assumption:** A `space_invitations` table with token-based invites, expiry, and status tracking is required for Phase 2.

### Gap 3 — No `updated_at` columns

[`database.md`](docs/database.md) only specifies `created_at`. Editable entities need `updated_at` for audit and cache invalidation.

**Assumption:** `updated_at` is added to mutable tables (`profiles`, `spaces`, `memories`, `comments`), auto-maintained by a trigger.

### Gap 4 — Tags scope ambiguity

[`database.md`](docs/database.md) §10 says `space_id` is *"optional for future filtering."* But [`feature-specs.md`](docs/feature-specs.md) §6 says: *"Tags are shared within a Space"* and *"Duplicate tags are not allowed within the same Space."*

**Assumption:** Tags are per-Space (not global). `space_id` is `NOT NULL`. Uniqueness is enforced per-Space, case-insensitive.

### Gap 5 — No media storage path

[`database.md`](docs/database.md) §7 has only `url`. Supabase Storage cleanup requires the storage path.

**Assumption:** A `storage_path` column is added to `media` for reliable file deletion from Supabase Storage.

### Gap 6 — Soft delete strategy undefined

[`feature-specs.md`](docs/feature-specs.md) §4 explicitly says comments use hard delete. No guidance for Memories.

**Assumption:** Soft delete (`deleted_at`) is used for Memories only. All other tables use hard delete. This aligns with [`blueprint.md`](docs/blueprint.md) §7: *"Losing a Memory is far worse than delaying a feature."*

### Gap 7 — Reaction type representation

[`database.md`](docs/database.md) §9 lists emoji as the `type`. Storing emoji directly in the DB is fragile for indexing and comparison.

**Assumption:** Reaction types are stored as text enum strings (`'heart'`, `'laugh'`, `'fire'`, `'tearful'`, `'clap'`, `'surprised'`) with a CHECK constraint. The frontend maps these to emoji.

### Gap 8 — Foreign key nullability conflicts

Three foreign keys were initially declared `NOT NULL` with `ON DELETE SET NULL`, which is contradictory — PostgreSQL cannot set a NOT NULL column to NULL.

**Resolution:** The three affected columns (`spaces.created_by`, `space_invitations.invited_by`, `memories.created_by`) are made **nullable** with `ON DELETE SET NULL`. See §7 for the full rationale per column.

---

# 3. Final Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| User identity | `profiles` table mirroring `auth.users` | Supabase Auth manages authentication; app-level data lives in `profiles` |
| Invitation handling | Token-based `space_invitations` table with expiry & status | Required by [`feature-specs.md`](docs/feature-specs.md) §1 |
| Invitation expiry | 7 days | Reasonable window for acceptance; prevents stale invites |
| Reaction types | Text enum strings, not emoji | Stable for indexing, comparison, and CHECK constraints |
| Tag scope | Per-Space (`space_id` NOT NULL) | [`feature-specs.md`](docs/feature-specs.md) §6: tags shared within a Space, no duplicates per Space |
| Tag case sensitivity | Case-insensitive (stored as-is, uniqueness on `lower(name)`) | [`feature-specs.md`](docs/feature-specs.md) §6: *"Tags are case-insensitive"* |
| Memory soft delete | Yes (`deleted_at` column) | Memories are the most valuable data; accidental loss is catastrophic |
| Comment soft delete | No (hard delete) | [`feature-specs.md`](docs/feature-specs.md) §4: *"Deleted comments are removed permanently"* |
| Space soft delete | No (hard delete) | Owner-confirmed action; cascades clean all child data |
| `spaces.created_by` nullability | Nullable + ON DELETE SET NULL | Space survives creator departure; ownership via `space_members` |
| `memories.created_by` nullability | Nullable + ON DELETE SET NULL | Memory survives creator departure; content is what matters |
| `space_invitations.invited_by` nullability | Nullable + ON DELETE SET NULL | Invitation survives inviter departure; belongs to Space |
| Timestamps | `timestamptz` for all timestamps; `date` for `memory_date` | UTC storage; `memory_date` is a calendar day, not a moment |
| Storage bucket | Private `media` bucket with path convention | RLS-mirrored storage policies |

---

# 4. Complete Table Inventory

10 tables, organized by roadmap phase:

| # | Table | Source | Phase |
|---|-------|--------|-------|
| 1 | `profiles` | Inferred (Supabase Auth pattern) | Phase 1 — Foundation |
| 2 | `spaces` | [`database.md`](docs/database.md) §4 | Phase 2 — Spaces |
| 3 | `space_members` | [`database.md`](docs/database.md) §5 | Phase 2 — Spaces |
| 4 | `space_invitations` | Inferred from [`feature-specs.md`](docs/feature-specs.md) §1 | Phase 2 — Spaces |
| 5 | `memories` | [`database.md`](docs/database.md) §6 | Phase 3 — Memories |
| 6 | `media` | [`database.md`](docs/database.md) §7 | Phase 3 — Memories |
| 7 | `tags` | [`database.md`](docs/database.md) §10 | Phase 4 — Experience |
| 8 | `memory_tags` | [`database.md`](docs/database.md) §11 | Phase 4 — Experience |
| 9 | `comments` | [`database.md`](docs/database.md) §8 | Phase 4 — Experience |
| 10 | `reactions` | [`database.md`](docs/database.md) §9 | Phase 4 — Experience |

---

# 5. Table Specifications

## 5.1 `profiles`

Extends Supabase Auth's `auth.users` with app-level user data.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | **PK**, FK → `auth.users.id` ON DELETE CASCADE |
| `name` | text | NOT NULL |
| `avatar_url` | text | nullable |
| `created_at` | timestamptz | NOT NULL, default `now()` |
| `updated_at` | timestamptz | NOT NULL, default `now()` (trigger-maintained) |

**Notes:**
- Populated by the `handle_new_user()` trigger on `auth.users INSERT`.
- `name` is sourced from `user_metadata.name` (set by [`SignUpPage.tsx`](app/avero/src/pages/SignUpPage.tsx)).
- This table is the FK target for all user references throughout the schema.

---

## 5.2 `spaces`

A private, shared memory environment.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | **PK**, default `gen_random_uuid()` |
| `name` | text | NOT NULL |
| `description` | text | nullable |
| `created_by` | UUID | **nullable**, FK → `profiles.id` ON DELETE SET NULL |
| `created_at` | timestamptz | NOT NULL, default `now()` |
| `updated_at` | timestamptz | NOT NULL, default `now()` (trigger-maintained) |

**Notes:**
- `created_by` is nullable because it uses `ON DELETE SET NULL`. The Space survives if the creator deletes their account.
- Ownership is tracked functionally through `space_members` (creator auto-added as `owner` via trigger), not through `created_by`.
- `created_by` is audit/informational metadata, not the source of truth for ownership.

---

## 5.3 `space_members`

Membership junction between users and spaces.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | **PK**, default `gen_random_uuid()` |
| `space_id` | UUID | NOT NULL, FK → `spaces.id` ON DELETE CASCADE |
| `user_id` | UUID | NOT NULL, FK → `profiles.id` ON DELETE CASCADE |
| `role` | text | NOT NULL, CHECK IN (`'owner'`, `'member'`) |
| `joined_at` | timestamptz | NOT NULL, default `now()` |

**Constraints:**
- UNIQUE (`space_id`, `user_id`) — prevents duplicate memberships

**Notes:**
- Both FKs use CASCADE. If a Space is deleted, memberships go. If a user deletes their account, their memberships go.
- This table is the RLS gatekeeper — the `is_space_member()` helper queries it.

---

## 5.4 `space_invitations`

Token-based invitations to join a Space.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | **PK**, default `gen_random_uuid()` |
| `space_id` | UUID | NOT NULL, FK → `spaces.id` ON DELETE CASCADE |
| `email` | text | NOT NULL — invitee's email |
| `invited_by` | UUID | **nullable**, FK → `profiles.id` ON DELETE SET NULL |
| `role` | text | NOT NULL, default `'member'`, CHECK IN (`'owner'`, `'member'`) |
| `token` | UUID | NOT NULL, UNIQUE, default `gen_random_uuid()` |
| `status` | text | NOT NULL, default `'pending'`, CHECK IN (`'pending'`, `'accepted'`, `'expired'`, `'cancelled'`) |
| `expires_at` | timestamptz | NOT NULL |
| `created_at` | timestamptz | NOT NULL, default `now()` |
| `accepted_at` | timestamptz | nullable |

**Notes:**
- `invited_by` is nullable because it uses `ON DELETE SET NULL`. The invitation survives if the inviter deletes their account.
- An invitation belongs to the Space, not to the inviter personally. The invitee should still be able to accept a pending invitation even if the inviter has since left.
- `expires_at` is set at creation to `now() + interval '7 days'`.
- `status` transitions: `pending` → `accepted` (on join) or `pending` → `expired` (past `expires_at`) or `pending` → `cancelled` (by Space owner).

---

## 5.5 `memories`

The core object of Avero.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | **PK**, default `gen_random_uuid()` |
| `space_id` | UUID | NOT NULL, FK → `spaces.id` ON DELETE CASCADE |
| `created_by` | UUID | **nullable**, FK → `profiles.id` ON DELETE SET NULL |
| `title` | text | NOT NULL |
| `description` | text | nullable |
| `memory_type` | text | nullable — e.g. "side quest", "trip" |
| `location` | text | nullable — string for MVP ([`database.md`](docs/database.md) §6) |
| `memory_date` | date | NOT NULL — when the event happened |
| `deleted_at` | timestamptz | nullable — **soft delete** |
| `created_at` | timestamptz | NOT NULL, default `now()` |
| `updated_at` | timestamptz | NOT NULL, default `now()` (trigger-maintained) |

**Notes:**
- `created_by` is nullable because it uses `ON DELETE SET NULL`. The Memory survives if the creator deletes their account.
- [`feature-specs.md`](docs/feature-specs.md) §2 states: *"A Memory cannot exist without a creator."* This is interpreted as a **creation-time invariant** — a creator must be specified at insert time. It does not mean the memory must be destroyed if the creator's account is later deleted.
- `memory_date` is `date` (not `timestamptz`) because a memory's date is a calendar day, not a precise moment.
- `deleted_at` enables soft delete. Queries and RLS policies filter `WHERE deleted_at IS NULL`.

---

## 5.6 `media`

Photos and videos attached to memories.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | **PK**, default `gen_random_uuid()` |
| `memory_id` | UUID | NOT NULL, FK → `memories.id` ON DELETE CASCADE |
| `url` | text | NOT NULL — public/signed URL |
| `storage_path` | text | NOT NULL — Supabase Storage path |
| `type` | text | NOT NULL, CHECK IN (`'image'`, `'video'`) |
| `created_at` | timestamptz | NOT NULL, default `now()` |

**Notes:**
- CASCADE on `memory_id` — media cannot exist without a memory ([`database.md`](docs/database.md) §13, [`feature-specs.md`](docs/feature-specs.md) §3).
- `storage_path` is required for reliable Storage object deletion when media is removed.
- A trigger or Edge Function should delete the Storage object when a media row is deleted.

---

## 5.7 `tags`

Per-Space labels for organizing memories.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | **PK**, default `gen_random_uuid()` |
| `space_id` | UUID | NOT NULL, FK → `spaces.id` ON DELETE CASCADE |
| `name` | text | NOT NULL |
| `created_at` | timestamptz | NOT NULL, default `now()` |

**Constraints:**
- UNIQUE (`space_id`, lower(`name`)) — case-insensitive, no duplicates per Space ([`feature-specs.md`](docs/feature-specs.md) §6)

**Notes:**
- Tags are per-Space, not global. `space_id` is NOT NULL.
- Case-insensitive uniqueness is enforced via a unique index on `lower(name)`.

---

## 5.8 `memory_tags`

Many-to-many junction between memories and tags.

| Column | Type | Constraints |
|--------|------|-------------|
| `memory_id` | UUID | NOT NULL, FK → `memories.id` ON DELETE CASCADE |
| `tag_id` | UUID | NOT NULL, FK → `tags.id` ON DELETE CASCADE |

**Constraints:**
- **Composite PK** (`memory_id`, `tag_id`)

**Notes:**
- Both FKs use CASCADE. Junction rows are cleaned up automatically when either side is deleted.

---

## 5.9 `comments`

User-generated context on memories.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | **PK**, default `gen_random_uuid()` |
| `memory_id` | UUID | NOT NULL, FK → `memories.id` ON DELETE CASCADE |
| `user_id` | UUID | NOT NULL, FK → `profiles.id` ON DELETE CASCADE |
| `content` | text | NOT NULL |
| `created_at` | timestamptz | NOT NULL, default `now()` |
| `updated_at` | timestamptz | NOT NULL, default `now()` (trigger-maintained) |

**Notes:**
- Both FKs use CASCADE. Comments cannot exist without a memory or an author ([`feature-specs.md`](docs/feature-specs.md) §4: *"No anonymous comments"*).
- Hard delete only — [`feature-specs.md`](docs/feature-specs.md) §4: *"Deleted comments are removed permanently (no soft delete for MVP)."*
- `updated_at` is included to support potential comment editing in MVP.

---

## 5.10 `reactions`

Emotional validation of memories.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | **PK**, default `gen_random_uuid()` |
| `memory_id` | UUID | NOT NULL, FK → `memories.id` ON DELETE CASCADE |
| `user_id` | UUID | NOT NULL, FK → `profiles.id` ON DELETE CASCADE |
| `type` | text | NOT NULL, CHECK IN (`'heart'`, `'laugh'`, `'fire'`, `'tearful'`, `'clap'`, `'surprised'`) |
| `created_at` | timestamptz | NOT NULL, default `now()` |

**Constraints:**
- UNIQUE (`memory_id`, `user_id`, `type`) — one reaction per type per user per memory ([`feature-specs.md`](docs/feature-specs.md) §5)

**Notes:**
- Both FKs use CASCADE. Reactions are personal and tied to memories.
- Hard delete — reactions are toggles, removed by deleting the row.
- Reaction types are stored as text enum strings, not emoji. The frontend maps: `heart` → ❤️, `laugh` → 😂, `fire` → 🔥, `tearful` → 🥹, `clap` → 👏, `surprised` → 😮.

---

# 6. Relationships

```
auth.users (Supabase managed)
    │ 1:1
    ▼
profiles ───────────────────────────────────────────────┐
    │                                                     │
    │ 1:N (created_by)          1:N (user_id)             │ 1:N (invited_by)
    ▼                            ▼                         ▼
spaces ──1:N──> memories    space_members <──N:1── profiles
  │   │              │              │
  │  1:N             1:N           N:1
  │   │              │              │
  │   ▼              ▼              ▼
  │ space_       media          (membership)
  │ invitations
  │   │
  │  1:N
  │   │
  ▼   ▼
spaces ──1:N──> tags ──N:N──> memories
                  ▲              │
                  │             1:N
              memory_tags        │
                                ▼
                           comments
                           reactions
```

**Key relationships** (from [`database.md`](docs/database.md) §12):
- Users belong to Spaces via `space_members`
- Spaces contain Memories
- Memories contain Media
- Memories have Comments + Reactions
- Memories can have multiple Tags (via `memory_tags`)

---

# 7. Foreign Keys & Cascade Behavior

## 7.1 Full Cascade Table

| FK | On Delete | Nullable? | Rationale |
|----|-----------|-----------|-----------|
| `profiles.id` → `auth.users.id` | CASCADE | N/A (PK) | Profile deleted with auth account |
| `spaces.created_by` → `profiles.id` | SET NULL | **Yes** | Space survives creator departure; ownership via `space_members` |
| `space_members.space_id` → `spaces.id` | CASCADE | No | No memberships without a space |
| `space_members.user_id` → `profiles.id` | CASCADE | No | Membership is personal; removed with account |
| `space_invitations.space_id` → `spaces.id` | CASCADE | No | No invites without a space |
| `space_invitations.invited_by` → `profiles.id` | SET NULL | **Yes** | Invitation survives; belongs to Space, not inviter |
| `memories.space_id` → `spaces.id` | CASCADE | No | Memories belong to space |
| `memories.created_by` → `profiles.id` | SET NULL | **Yes** | Memory survives; content is what matters |
| `media.memory_id` → `memories.id` | CASCADE | No | Media cannot exist without memory |
| `tags.space_id` → `spaces.id` | CASCADE | No | Tags are space-scoped |
| `memory_tags.memory_id` → `memories.id` | CASCADE | No | Junction cleanup |
| `memory_tags.tag_id` → `tags.id` | CASCADE | No | Junction cleanup |
| `comments.memory_id` → `memories.id` | CASCADE | No | Comments tied to memory |
| `comments.user_id` → `profiles.id` | CASCADE | No | No anonymous comments |
| `reactions.memory_id` → `memories.id` | CASCADE | No | Reactions tied to memory |
| `reactions.user_id` → `profiles.id` | CASCADE | No | Reactions are personal |

## 7.2 Constraint Rule

> Every `ON DELETE SET NULL` foreign key is nullable. Every `NOT NULL` foreign key uses `CASCADE`. No `NOT NULL` + `SET NULL` conflicts exist.

## 7.3 Rationale for the Three Nullable FKs

### `spaces.created_by` (nullable + SET NULL)

The Space belongs to its members, not just its creator ([`blueprint.md`](docs/blueprint.md) §Core Concepts: *"Spaces are built around relationships, not individual profiles"*). Ownership is tracked through `space_members` where the creator is auto-added as `owner` via trigger. The `created_by` column is audit metadata. If the creator deletes their account, the Space and all its memories survive intact.

### `space_invitations.invited_by` (nullable + SET NULL)

An invitation belongs to the Space, not to the inviter personally. The invitee should still be able to accept a pending invitation even if the inviter has since left. The `invited_by` field records who initiated the invitation for traceability, but is not functionally required for the invitation to be valid.

### `memories.created_by` (nullable + SET NULL)

This is the most critical decision. [`feature-specs.md`](docs/feature-specs.md) §2 states: *"A Memory cannot exist without a creator."* This is interpreted as a **creation-time invariant** — a creator must be specified at insert time. It does not mean the memory must be destroyed if the creator's account is later deleted. The memory's value lies in its content (title, description, media, comments, reactions, date), not in the continued existence of the creator's account. The memory survives; `created_by` becomes NULL.

---

# 8. Soft Delete vs Hard Delete

| Table | Strategy | Reason |
|-------|----------|--------|
| `memories` | **Soft delete** (`deleted_at`) | Core value of Avero; accidental loss is catastrophic ([`blueprint.md`](docs/blueprint.md) §7) |
| `spaces` | Hard delete | Owner-confirmed action; cascades clean all child data |
| `space_members` | Hard delete | Leaving a space is intentional |
| `space_invitations` | Hard delete (or status update) | No need to retain expired invites long-term |
| `media` | Hard delete (+ Storage cleanup) | Tied to memory lifecycle |
| `comments` | **Hard delete** | Explicitly required by [`feature-specs.md`](docs/feature-specs.md) §4 |
| `reactions` | Hard delete | Toggles; no archival value |
| `tags` | Hard delete | Organizational labels |
| `memory_tags` | Hard delete | Junction rows |
| `profiles` | Hard delete (via auth cascade) | Account deletion is intentional |

---

# 9. Timestamp Strategy

| Timestamp | Type | Applied To | Maintenance |
|-----------|------|------------|-------------|
| `created_at` | `timestamptz` | All tables | Default `now()`, never updated |
| `updated_at` | `timestamptz` | `profiles`, `spaces`, `memories`, `comments` | Trigger `set_updated_at()` before UPDATE |
| `memory_date` | `date` | `memories` | User-provided (when event happened, not when recorded) |
| `joined_at` | `timestamptz` | `space_members` | Default `now()` |
| `expires_at` | `timestamptz` | `space_invitations` | Set at creation (`now() + interval '7 days'`) |
| `accepted_at` | `timestamptz` | `space_invitations` | Set on acceptance |
| `deleted_at` | `timestamptz` | `memories` | Set on soft delete |

**Why `timestamptz` not `timestamp`:** Stores UTC, immune to timezone interpretation issues. The app converts to the user's timezone for display.

**Why `memory_date` is `date` not `timestamptz`:** A memory's date is a calendar day, not a precise moment. Time-of-day is not meaningful for "the day we went hiking."

---

# 10. Indexes

| Table | Index | Purpose |
|-------|-------|---------|
| `profiles` | PK (`id`) | Lookup |
| `spaces` | PK (`id`), (`created_by`) | Lookup, user's created spaces |
| `space_members` | PK (`id`), UNIQUE (`space_id`, `user_id`), (`user_id`) | Dedup, "my spaces" query |
| `space_invitations` | PK (`id`), UNIQUE (`token`), (`email`), (`space_id`) | Token lookup, invitee lookup, space invites |
| `memories` | PK (`id`), (`space_id`, `memory_date` DESC), partial (`space_id`, `memory_date` DESC) WHERE `deleted_at IS NULL`, (`created_by`) | Timeline, active timeline, creator lookup |
| `media` | PK (`id`), (`memory_id`) | Memory's media |
| `tags` | PK (`id`), UNIQUE (`space_id`, lower(`name`)), (`space_id`) | Dedup, space tags |
| `memory_tags` | PK (`memory_id`, `tag_id`), (`tag_id`) | Junction, reverse lookup |
| `comments` | PK (`id`), (`memory_id`, `created_at`) | Chronological comments |
| `reactions` | PK (`id`), UNIQUE (`memory_id`, `user_id`, `type`), (`memory_id`) | Dedup, reaction counts |

**Partial index note:** The `memories` table has a partial index on `(`space_id`, `memory_date` DESC) WHERE deleted_at IS NULL`. This optimizes the most common query — fetching active memories for the timeline — without including soft-deleted rows.

---

# 11. Row Level Security Strategy

## 11.1 Core Rule

From [`feature-specs.md`](docs/feature-specs.md) §9:

> If you are not in the Space, you cannot see anything inside it. No exceptions in MVP.

## 11.2 Design Principles

- **RLS enabled on every table** — no exceptions ([`ai-context.md`](docs/ai-context.md) §10).
- **Deny by default** — no policy means no access.
- **Membership is the gate** — all content access flows through `is_space_member()`.
- **Soft-deleted memories excluded** — SELECT policies include `deleted_at IS NULL`.

## 11.3 Helper Function

A reusable SQL function `is_space_member(p_space_id UUID)` returns `boolean` — checks whether `auth.uid()` exists in `space_members` for the given space. This avoids repeating the subquery in every policy.

## 11.4 Policy Matrix

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `profiles` | Own row OR shared-space member | — (trigger only) | Own row only | Own row only |
| `spaces` | Member of the space | Authenticated (creator auto-added as owner via trigger) | Owner of the space | Owner of the space |
| `space_members` | Member of the space | Owner of the space (or self via invite acceptance) | Owner of the space (role changes) | Owner (remove others) or self (leave) |
| `space_invitations` | Owner of the space OR invitee by email | Owner of the space | Owner of the space | Owner of the space |
| `memories` | Member of the space (and `deleted_at IS NULL`) | Member of the space | Creator OR space owner | Creator OR space owner |
| `media` | Member of the space (via memory's space) | Member of the space | Creator of the parent memory | Creator of the parent memory |
| `tags` | Member of the space | Member of the space | Member of the space | Space owner |
| `memory_tags` | Member of the space | Member of the space | — | Member of the space |
| `comments` | Member of the space | Member of the space | Author only | Author only (or space owner) |
| `reactions` | Member of the space | Member of the space | — (delete + re-insert) | Author only |

## 11.5 Nullable FK Impact on RLS

The three nullable columns affect how RLS policies handle NULL values:

| Table | Impact |
|-------|--------|
| `spaces` | SELECT policy checks `is_space_member(space_id)` — unaffected by `created_by` being NULL. UPDATE/DELETE policies check ownership via `space_members`, not `created_by`. |
| `space_invitations` | SELECT policy checks Space ownership or invitee email — unaffected by `invited_by` being NULL. |
| `memories` | SELECT policy checks `is_space_member(space_id)` — unaffected by `created_by` being NULL. UPDATE/DELETE policies must handle NULL: if `created_by IS NULL`, only Space owners can modify (the original creator is gone). |

**Memories UPDATE/DELETE policy detail:** Space owners can always update/delete. If `created_by` is not NULL, the creator can also update/delete. If `created_by` is NULL, only the space owner can.

---

# 12. Triggers & Functions

| Name | Fires On | Purpose |
|------|----------|---------|
| `handle_new_user()` | `auth.users` INSERT | Create `profiles` row from `user_metadata` |
| `set_updated_at()` | UPDATE on `profiles`, `spaces`, `memories`, `comments` | Auto-maintain `updated_at` |
| `handle_new_space()` | `spaces` INSERT | Auto-add creator as `owner` in `space_members` |
| `is_space_member(uuid)` | (called from RLS policies) | Check if `auth.uid()` is a member of a space |

**Notes:**
- `handle_new_user()` reads `new.raw_user_meta_data->>'name'` to populate `profiles.name`.
- `handle_new_space()` inserts a `space_members` row with `role = 'owner'` for the creating user. This must happen in the same transaction to ensure the Space always has at least one owner ([`feature-specs.md`](docs/feature-specs.md) §1: *"Every Space must have at least 1 owner"*).
- `set_updated_at()` sets `new.updated_at = now()` before any UPDATE on the affected tables.

---

# 13. Supabase Storage Strategy

## 13.1 Bucket

| Bucket | Visibility | Purpose |
|--------|------------|---------|
| `media` | Private | User-uploaded photos and videos |

## 13.2 Path Convention

```
spaces/{space_id}/memories/{memory_id}/{media_id}.{ext}
```

**Rationale:** Path includes `space_id` and `memory_id` so Storage policies can verify membership at the path level, mirroring database RLS.

## 13.3 Storage Policies

Storage policies must mirror the database RLS:
- **Upload:** User must be a member of the Space that owns the memory.
- **Read:** User must be a member of the Space that owns the memory.
- **Delete:** User must be the creator of the parent memory or a Space owner.

## 13.4 Media Deletion

When a `media` row is deleted (via CASCADE from memory deletion or direct deletion), the corresponding Storage object must also be removed. This should be handled by a trigger or Edge Function to prevent orphaned Storage objects.

---

# 14. Implementation Order

The implementation follows a strict dependency order. Each step depends on the previous step being complete.

## Step 1 — Extensions

Enable required PostgreSQL extensions:
- `pgcrypto` (for `gen_random_uuid()`)

## Step 2 — Tables

Create tables in dependency order (parents before children):

1. `profiles` (depends on `auth.users` — Supabase managed)
2. `spaces` (depends on `profiles`)
3. `space_members` (depends on `spaces`, `profiles`)
4. `space_invitations` (depends on `spaces`, `profiles`)
5. `memories` (depends on `spaces`, `profiles`)
6. `media` (depends on `memories`)
7. `tags` (depends on `spaces`)
8. `memory_tags` (depends on `memories`, `tags`)
9. `comments` (depends on `memories`, `profiles`)
10. `reactions` (depends on `memories`, `profiles`)

## Step 3 — Constraints

Add CHECK constraints, UNIQUE constraints, and composite primary keys:
- `space_members.role` CHECK IN (`'owner'`, `'member'`)
- `space_invitations.role` CHECK IN (`'owner'`, `'member'`)
- `space_invitations.status` CHECK IN (`'pending'`, `'accepted'`, `'expired'`, `'cancelled'`)
- `media.type` CHECK IN (`'image'`, `'video'`)
- `reactions.type` CHECK IN (`'heart'`, `'laugh'`, `'fire'`, `'tearful'`, `'clap'`, `'surprised'`)
- `space_members` UNIQUE (`space_id`, `user_id`)
- `space_invitations` UNIQUE (`token`)
- `tags` UNIQUE (`space_id`, lower(`name`))
- `memory_tags` composite PK (`memory_id`, `tag_id`)
- `reactions` UNIQUE (`memory_id`, `user_id`, `type`)

## Step 4 — Indexes

Create all indexes listed in §10, including the partial index on `memories` for soft-deleted row exclusion.

## Step 5 — Triggers & Functions

Create in this order:
1. `set_updated_at()` function + triggers on `profiles`, `spaces`, `memories`, `comments`
2. `handle_new_user()` trigger on `auth.users`
3. `handle_new_space()` trigger on `spaces`
4. `is_space_member()` helper function

## Step 6 — Storage

1. Create the `media` bucket (private)
2. Set path convention: `spaces/{space_id}/memories/{memory_id}/{media_id}.{ext}`
3. Create Storage policies mirroring database RLS

## Step 7 — Row Level Security

1. Enable RLS on all 10 tables
2. Create the `is_space_member()` helper function (if not already created in Step 5)
3. Create policies in dependency order:
   - `profiles` policies
   - `spaces` policies
   - `space_members` policies
   - `space_invitations` policies
   - `memories` policies
   - `media` policies
   - `tags` policies
   - `memory_tags` policies
   - `comments` policies
   - `reactions` policies

## Step 8 — Verification

1. Verify `handle_new_user()` creates a `profiles` row on sign-up
2. Verify `handle_new_space()` auto-adds creator as owner
3. Verify RLS blocks non-members from accessing Space content
4. Verify soft-deleted memories are excluded from SELECT queries
5. Verify CASCADE behavior on Space deletion (all child data removed)
6. Verify SET NULL behavior on account deletion (Space/Memory survive)
7. Verify Storage policies match database RLS

---

# 15. Future Scalability Considerations

| Concern | MVP Approach | Future Path |
|---------|-------------|-------------|
| Search | `ILIKE` on title/description + tag joins | `tsvector` + GIN index, or `pg_trgm` for fuzzy search |
| Large spaces | Single table, B-tree indexes | Partition `memories` by `space_id` at scale |
| Reaction counts | `COUNT(*)` aggregation query | Materialized view or counter cache column |
| Media storage | Supabase Storage, structured paths | CDN integration, image optimization pipeline |
| Location | Plain text string | Dedicated `locations` table with PostGIS + geocoding |
| Notifications | Not in MVP | `notifications` table + Realtime subscriptions |
| AI summaries | Not in MVP | Separate `memory_summaries` table (avoid bloating `memories`) |
| Audit log | `updated_at` + soft delete | Dedicated audit table with `operation_type` tracking |
| Connection pooling | Supabase default pool | PgBouncer / connection pooler tuning at scale |

---

# 16. Important Notes & Caveats

## 16.1 Application-Level Guard: Last Owner Scenario

If a user is the **last remaining owner** in `space_members` for a Space, deleting their account (which CASCADE-deletes their membership) would leave the Space with no owner — violating [`feature-specs.md`](docs/feature-specs.md) §1: *"Every Space must have at least 1 owner."*

This is an **application-level concern**, not a database constraint. The account-deletion flow must check for this and either:
- Prevent deletion until ownership is transferred, or
- Require the user to delete the Space first, or
- Prompt the user to assign a new owner.

This cannot be enforced purely at the database level without complex triggers that may introduce their own issues.

## 16.2 Memory Creator Interpretation

[`feature-specs.md`](docs/feature-specs.md) §2 states: *"A Memory cannot exist without a creator."* This is interpreted as a **creation-time invariant** (a creator must be specified at insert time), not a permanent NOT NULL constraint (the memory is not destroyed if the creator's account is later deleted).

If the creator identity must be permanently preserved, an alternative is to **denormalize** the creator's name into the memory at creation time (e.g., a `created_by_name` text column) so the display name survives even after account deletion. This is not included in the MVP but can be added if needed.

## 16.3 Invitation Expiry Enforcement

The `expires_at` column records when an invitation expires, but **enforcement is application-level**. The database does not automatically set `status = 'expired'`. The application must check `expires_at < now()` when an invitation is accessed and reject expired invitations per [`feature-specs.md`](docs/feature-specs.md) §1: *"Invalid or expired invites are rejected."*

A scheduled function (pg_cron or Edge Function) could periodically update expired invitations' status for cleanliness, but this is optional for MVP.

## 16.4 Media Upload Atomicity

[`feature-specs.md`](docs/feature-specs.md) §3 states: *"Upload failure must not create partial Memory state."* This means media upload must be handled carefully:

- The memory row should be created first.
- Media uploads should be associated with the memory only after successful upload to Storage.
- If a media upload fails, the memory should still exist (with its other media), but the failed media should not be partially committed.

This is an application-level transaction concern, not a database constraint.

## 16.5 Tag Case-Insensitive Uniqueness

Tags are case-insensitive ([`feature-specs.md`](docs/feature-specs.md) §6). Uniqueness is enforced via a unique index on `lower(name)` per Space. The `name` column itself stores the original casing as entered by the user. The application should normalize tag input (e.g., trim whitespace) before insert.

## 16.6 Reaction Type Stability

Reaction types are stored as text enum strings (`'heart'`, `'laugh'`, etc.), not emoji. This ensures:
- Stable for indexing and comparison.
- Immune to emoji rendering differences across platforms.
- Easy to extend with new types in the future.

The frontend is responsible for mapping these strings to emoji for display. The mapping is documented in §5.10.

## 16.7 Soft Delete Query Discipline

All queries against `memories` must include `WHERE deleted_at IS NULL` unless explicitly retrieving soft-deleted memories (e.g., for an admin restore feature, which is not in MVP). RLS SELECT policies enforce this, but application-level queries using the service role key must also respect this filter.

## 16.8 Supabase Auth Dependency

The `profiles` table depends on Supabase Auth's `auth.users` table. The `handle_new_user()` trigger fires on `auth.users INSERT`. This means:
- The trigger must be created at the database level, not through the Supabase dashboard.
- If Supabase Auth configuration changes (e.g., enabling/disabling email confirmation), the trigger behavior remains the same — it fires on user creation, not on email verification.

## 16.9 No Public Access in MVP

Per [`feature-specs.md`](docs/feature-specs.md) §8: *"No public access exists in MVP."* All RLS policies require authentication. There are no anonymous/public policies. This may change in future versions if public Spaces are introduced, but that is explicitly out of scope ([`blueprint.md`](docs/blueprint.md) §8: *"Public Spaces"* listed under "Not Included").

---

## Document Status

**Version:** 1.0

**Status:** 🟢 Approved

**Last Updated:** July 3, 2026

**Next Review:** Before database implementation begins
