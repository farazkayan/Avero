/**
 * Shared types for the Spaces feature (spaces-design §5.5).
 *
 * Co-located in a single module so every Spaces screen — dashboard, detail,
 * invitations — agrees on the shape of a Space and a membership. Only the
 * fields used by the current scope are declared; the file grows as later
 * screens need more.
 */

/** A user's role within a Space (spaces-design §1.1). */
export type SpaceRole = "owner" | "member";

/** A Space — a private, shared memory environment (database §5.2). */
export type Space = {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * A `space_members` row joined with its `spaces` row, as returned by the
 * dashboard's fetch (spaces-design §7.1):
 *
 *   supabase.from("space_members").select("*, spaces(*)").eq("user_id", user.id)
 *
 * The Supabase client is created without a generated `Database` type, so the
 * SDK returns loosely-typed data; this interface gives the dashboard a
 * statically-typed view of that joined result.
 */
export type SpaceMembershipWithSpace = {
  id: string;
  space_id: string;
  user_id: string;
  role: SpaceRole;
  joined_at: string;
  spaces: Space;
};

/**
 * The `profiles` columns joined onto a `space_members` row by the Space
 * detail fetch (spaces-design §7.3):
 *
 *   supabase.from("space_members").select("*, profiles(name, avatar_url)").eq("space_id", spaceId)
 *
 * `profiles` is optional because a member's profile row could theoretically be
 * absent (e.g. mid-cascade); the UI falls back gracefully when it is missing.
 */
export type SpaceMemberProfile = {
  name: string;
  avatar_url: string | null;
};

/**
 * A `space_members` row joined with its `profiles` row, as returned by the
 * Space detail page's member-list fetch (spaces-design §7.3).
 *
 * The Supabase client is created without a generated `Database` type, so the
 * SDK returns loosely-typed data; this interface gives the detail page a
 * statically-typed view of that joined result.
 */
export type SpaceMember = {
  id: string;
  space_id: string;
  user_id: string;
  role: SpaceRole;
  joined_at: string;
  profiles?: SpaceMemberProfile;
};

/** The lifecycle status of an invitation (database §5.4). */
export type InvitationStatus = "pending" | "accepted" | "expired" | "cancelled";

/** The role an invitation grants on acceptance (database §5.4). */
export type InvitationRole = SpaceRole;

/**
 * A `space_invitations` row (database §5.4, spaces-design §5.5).
 *
 * Token-based invitation to join a Space. The `token` column has a database
 * default (`gen_random_uuid()`), so the client does NOT set it on insert — it
 * is returned by the insert's `.select()` and used to build the invite link
 * (`{origin}/invite/{token}`). `expires_at` is set client-side to
 * `now() + 7 days` at insert time; the database does not auto-flip `status`
 * to `'expired'`, so expiry is enforced application-level
 * (backend-implementation §16.3).
 */
export type SpaceInvitation = {
  id: string;
  space_id: string;
  email: string;
  invited_by: string | null;
  role: InvitationRole;
  token: string;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
};
