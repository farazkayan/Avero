import type { SpaceMember, SpaceRole } from "../../types/space";

type MemberRowProps = {
  member: SpaceMember;
  /** Whether the row represents the currently signed-in user. */
  isCurrentUser?: boolean;
};

/**
 * A single member in the Space detail member list (spaces-design §6.3,
 * design-system §6).
 *
 * Displays the member's display name (falling back to a truncated user id when
 * the joined profile is missing), their role as a badge, and a "You" marker
 * when the row is the current user. The role badge reuses the same visual
 * language as `SpaceCard`'s `RoleBadge` so owner/member reads consistently
 * across the dashboard and the detail page.
 *
 * This is a presentational component — it takes a `SpaceMember` and renders
 * it. Any owner-only actions (remove member) are not part of this step and
 * will be added alongside the invitations UI.
 */
export default function MemberRow({
  member,
  isCurrentUser = false,
}: MemberRowProps) {
  const displayName = member.profiles?.name ?? "Unknown member";

  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={displayName} avatarUrl={member.profiles?.avatar_url} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">
            {displayName}
            {isCurrentUser && (
              <span className="ml-2 text-xs font-normal text-ink-muted">
                (you)
              </span>
            )}
          </p>
        </div>
      </div>
      <RoleBadge role={member.role} />
    </li>
  );
}

/**
 * A member's avatar. When a profile has no `avatar_url`, render the first
 * initial of their name on a soft accent surface — a calm, deterministic
 * placeholder that avoids a broken-image glyph.
 */
function Avatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null | undefined;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="h-9 w-9 shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-400"
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

function RoleBadge({ role }: { role: SpaceRole }) {
  if (role === "owner") {
    return (
      <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-400">
        Owner
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-white/5 px-2.5 py-0.5 text-xs font-medium text-ink-muted">
      Member
    </span>
  );
}
