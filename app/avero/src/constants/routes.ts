/**
 * Centralized route path constants.
 *
 * Keeping every route path in one place prevents magic-string drift between
 * the route table and the route guards, and makes the temporary authenticated
 * landing path trivial to swap when the real Spaces dashboard is built — only
 * this file needs to change.
 */

/** Authenticated landing route — the Spaces dashboard (spaces-design §6.1). */
export const AUTHENTICATED_HOME_PATH = "/spaces";

/**
 * Create-space route (spaces-design §6.2).
 */
export const SPACE_CREATE_PATH = "/spaces/new";

/**
 * Space detail/settings route template (spaces-design §6.3).
 *
 * Use {@link spaceDetailPath} to build a concrete path for a given space id.
 */
export const SPACE_DETAIL_PATH = "/spaces/:spaceId";

/**
 * Builds a concrete Space detail path from a space id.
 *
 * The route constant above carries the `:spaceId` parameter placeholder; this
 * helper substitutes it so callers never hand-concatenate the path.
 */
export function spaceDetailPath(spaceId: string): string {
  return `/spaces/${spaceId}`;
}

/**
 * Space settings route template (spaces-design §6.3 — settings relocated).
 *
 * The Space detail route (`/spaces/:spaceId`) now hosts the Memories timeline;
 * the former detail content (members, invite, danger zone) lives here under a
 * `/settings` suffix. Use {@link spaceSettingsPath} to build a concrete path.
 */
export const SPACE_SETTINGS_PATH = "/spaces/:spaceId/settings";

/**
 * Builds a concrete Space settings path from a space id.
 *
 * The route constant above carries the `:spaceId` parameter placeholder; this
 * helper substitutes it so callers never hand-concatenate the path.
 */
export function spaceSettingsPath(spaceId: string): string {
  return `/spaces/${spaceId}/settings`;
}

/**
 * Create-memory route template (feature-specs §2, roadmap Phase 3 Step 1).
 *
 * Use {@link memoryCreatePath} to build a concrete path for a given space id.
 */
export const MEMORY_CREATE_PATH = "/spaces/:spaceId/memories/new";

/**
 * Builds a concrete Create Memory path from a space id.
 *
 * The route constant above carries the `:spaceId` parameter placeholder; this
 * helper substitutes it so callers never hand-concatenate the path.
 */
export function memoryCreatePath(spaceId: string): string {
  return `/spaces/${spaceId}/memories/new`;
}

/**
 * Memory detail route template (feature-specs §2).
 *
 * Use {@link memoryDetailPath} to build a concrete path for a given space id
 * and memory id.
 */
export const MEMORY_DETAIL_PATH = "/spaces/:spaceId/memories/:memoryId";

/**
 * Builds a concrete Memory detail path from a space id and a memory id.
 *
 * The route constant above carries the `:spaceId` and `:memoryId` parameter
 * placeholders; this helper substitutes them so callers never hand-concatenate
 * the path.
 */
export function memoryDetailPath(spaceId: string, memoryId: string): string {
  return `/spaces/${spaceId}/memories/${memoryId}`;
}

/**
 * Edit-memory route template (feature-specs §2).
 *
 * Use {@link memoryEditPath} to build a concrete path for a given space id and
 * memory id. Editing is restricted to the Memory's creator or the Space owner
 * (mirrors the `memories_update` RLS policy: `is_space_owner(space_id) OR
 * created_by = auth.uid()`); the edit page enforces the same gate client-side
 * and redirects unauthorized users away.
 */
export const MEMORY_EDIT_PATH = "/spaces/:spaceId/memories/:memoryId/edit";

/**
 * Builds a concrete Edit Memory path from a space id and a memory id.
 *
 * The route constant above carries the `:spaceId` and `:memoryId` parameter
 * placeholders; this helper substitutes them so callers never hand-concatenate
 * the path.
 */
export function memoryEditPath(spaceId: string, memoryId: string): string {
  return `/spaces/${spaceId}/memories/${memoryId}/edit`;
}

/**
 * Accept-invite route template (spaces-design §6.5, §10.5 — path parameter).
 *
 * The invite link built by the send-invite UI points here with the invitee's
 * token substituted into the path. NOTE: the route registration and the
 * `AcceptInvitePage` are a separate future step — this constant only declares
 * the agreed path so the send-invite UI can construct copyable links today.
 */
export const INVITE_ACCEPT_PATH = "/invite/:token";

/**
 * Builds a concrete accept-invite path from an invitation token.
 *
 * The route constant above carries the `:token` placeholder; this helper
 * substitutes it so callers never hand-concatenate the path. Pair with
 * `window.location.origin` to produce a full, shareable URL.
 */
export function inviteAcceptPath(token: string): string {
  return `/invite/${token}`;
}

/** Sign-in route. */
export const SIGN_IN_PATH = "/signin";

/** Sign-up route. */
export const SIGN_UP_PATH = "/signup";

/** Forgot-password route. */
export const FORGOT_PASSWORD_PATH = "/forgot-password";

/** Email verification notice route. */
export const VERIFY_EMAIL_PATH = "/verify-email";

/** Password reset route. */
export const RESET_PASSWORD_PATH = "/reset-password";
