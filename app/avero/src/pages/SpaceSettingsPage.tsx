import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import TextField from "../components/ui/TextField";
import PrimaryButton from "../components/ui/PrimaryButton";
import GhostLink from "../components/ui/GhostLink";
import Spinner from "../components/ui/Spinner";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import MemberRow from "../components/spaces/MemberRow";
import StitchTextField from "../components/ui/StitchTextField";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  AUTHENTICATED_HOME_PATH,
  inviteAcceptPath,
  spaceDetailPath,
} from "../constants/routes";
import type { Space, SpaceInvitation, SpaceMember } from "../types/space";

/**
 * Maximum length for a Space name (mirrors CreateSpacePage).
 *
 * The `spaces.name` column is unconstrained `text`; 100 characters is a
 * sensible ceiling shared with the create flow so a name edited here can
 * never exceed what the create form would have allowed.
 */
const MAX_NAME_LENGTH = 100;

/**
 * Maximum length for a Space description (mirrors CreateSpacePage).
 */
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Space Settings (spaces-design §6.3 — relocated from the detail route).
 *
 * The Space detail route (`/spaces/:spaceId`) now hosts the Memories
 * timeline; the former detail content — editable name/description, members,
 * invite, and the danger zone — lives here under `/settings`.
 *
 * Fetches a single Space and its members on mount. RLS auto-filters both
 * queries: a non-member receives no rows for the Space, which resolves to a
 * calm "not found or no access" state rather than a raw error
 * (spaces-design §8 — "RLS will naturally return nothing for unauthorized
 * access").
 *
 * Role-based rendering (spaces-design §6.3):
 *  - Owner: editable name/description (inline edit mode), "Delete Space"
 *    button with a typed-name confirmation. Deleting a Space is
 *    irreversible and cascades to all child data (memories, media,
 *    comments, reactions, tags, members, invitations — see
 *    backend-implementation §7.1), so the confirm button stays disabled
 *    until the user types the Space's exact name. This mirrors the
 *    irreversible-action pattern used by GitHub/Vercel and is stronger
 *    than a two-step confirm.
 *  - Member: "Leave Space" button that calls the `leave_space()` RPC. On
 *    success, redirects to the dashboard. Leaving is reversible (the user
 *    can be re-invited), so it keeps the simpler two-step confirm.
 *
 * Send-invite UI (spaces-design §6.4, owner-only):
 *  - An "Invite" section with an email input + "Create Invite Link" button.
 *    On submit, inserts a `space_invitations` row. The `token` and
 *    `expires_at` columns both have database defaults
 *    (`gen_random_uuid()` and `now() + interval '7 days'` respectively), so
 *    the client does NOT set them — `token` is returned by the insert's
 *    `.select()` and used to build the copyable invite link
 *    (`{origin}/invite/{token}`), and `expires_at` is enforced server-side
 *    so a direct API call can't bypass the 7-day expiry policy.
 *  - Two server-side rejections are mapped to calm messages:
 *      • `23505` from the partial unique index → "An invite is already
 *        pending for this email."
 *      • `23505` from the `check_invitation_not_existing_member` trigger
 *        (message: "This person is already a member of this space.") →
 *        "This person is already a member of this space."
 *    Both surface as PostgreSQL `23505`; the trigger's message distinguishes
 *    the "already a member" case from the duplicate-pending case.
 *  - On success, the generated link is shown in a copyable format with a
 *    "Copy Link" button (Clipboard API).
 *  - A list of pending invites already sent for this Space (email + expiry)
 *    is fetched alongside the Space/member data and rendered below the form.
 *
 * The accept-invite flow (the `/invite/:token` page) is intentionally NOT
 * built here — it is a separate future step (spaces-design §6.5).
 */
export default function SpaceSettingsPage() {
  const { spaceId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [space, setSpace] = useState<Space | null>(null);
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  // Edit mode (owner only)
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editNameError, setEditNameError] = useState<string | undefined>(
    undefined
  );
  const [editDescriptionError, setEditDescriptionError] = useState<
    string | undefined
  >(undefined);
  const [editFormError, setEditFormError] = useState<string | undefined>(
    undefined
  );
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Leave dialog (member only)
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | undefined>(undefined);

  // Delete dialog (owner only)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);

  // Typed-name confirmation for the delete dialog. The confirm button stays
  // disabled until this exactly matches the Space's name. Deleting a Space is
  // irreversible and cascades to all child data, so a typed confirmation is
  // warranted (stronger than the two-step confirm used for the reversible
  // "Leave Space" action).
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const isDeleteNameMatched =
    space !== null && deleteConfirmName.trim() === space.name;

  // Send-invite UI (owner only — spaces-design §6.4)
  const [invitations, setInvitations] = useState<SpaceInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEmailError, setInviteEmailError] = useState<string | undefined>(
    undefined
  );
  const [inviteFormError, setInviteFormError] = useState<string | undefined>(
    undefined
  );
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);

  // The most recently created invite link, shown in a copyable format until
  // the user clears it or creates another. Holds the full URL
  // (`{origin}/invite/{token}`) so it can be copied verbatim.
  const [createdInviteLink, setCreatedInviteLink] = useState<string | null>(
    null
  );

  // "Copied" confirmation state for the Copy Link button. Resets after a
  // short delay so the button returns to its default label.
  const [isInviteLinkCopied, setIsInviteLinkCopied] = useState(false);

  useEffect(() => {
    if (!spaceId) {
      // React Router guarantees :spaceId is present when this page mounts
      // (the route only matches /spaces/:spaceId/settings). This guard only
      // satisfies the type system. It must not call setState synchronously
      // (react-hooks/set-state-in-effect), and since the branch is
      // unreachable in practice, leaving the initial loading state is fine.
      return;
    }

    let cancelled = false;

    async function fetchSpaceDetail(id: string) {
      setIsLoading(true);
      setNotFound(false);
      setLoadError(undefined);

      try {
        const [spaceResponse, membersResponse, invitationsResponse] =
          await Promise.all([
            supabase
              .from("spaces")
              .select("*")
              .eq("id", id)
              .maybeSingle(),
            supabase
              .from("space_members")
              .select("*, profiles(name, avatar_url)")
              .eq("space_id", id)
              .order("joined_at", { ascending: true }),
            // Pending invitations for this Space (spaces-design §7.3).
            // RLS restricts this to the Space owner; a non-owner receives
            // an empty list (no error), which is fine — the invite UI is
            // only rendered for owners anyway.
            supabase
              .from("space_invitations")
              .select("*")
              .eq("space_id", id)
              .eq("status", "pending")
              .order("created_at", { ascending: false }),
          ]);

        if (cancelled) {
          return;
        }

        // Space fetch — a PostgREST error here is either a malformed id
        // (treated as "not found") or a real failure (treated as "try
        // again"). RLS returning no rows resolves to null data with no
        // error, which is the normal "not a member / doesn't exist" path.
        if (spaceResponse.error) {
          if (spaceResponse.error.code === "22P02") {
            // invalid_text_representation — not a valid UUID
            setNotFound(true);
          } else {
            setLoadError("We couldn't load this Space. Please try again.");
          }
          return;
        }

        if (!spaceResponse.data) {
          // RLS returned no rows — the Space doesn't exist or the user
          // isn't a member. Both resolve to the same calm state.
          setNotFound(true);
          return;
        }

        // Members fetch — if the Space was found (RLS passed), the members
        // query should also pass (same membership check). A failure here is
        // unexpected; surface it as a general load error.
        if (membersResponse.error) {
          setLoadError("We couldn't load this Space. Please try again.");
          return;
        }

        // Invitations fetch — a non-owner receives an empty list (RLS
        // returns no rows without error), so a PostgREST error here is a
        // real failure, not a permissions outcome. Surface it as a general
        // load error; the rest of the page can still render.
        if (invitationsResponse.error) {
          setLoadError("We couldn't load this Space. Please try again.");
          return;
        }

        setSpace(spaceResponse.data as Space);
        setMembers((membersResponse.data ?? []) as SpaceMember[]);
        setInvitations(
          (invitationsResponse.data ?? []) as SpaceInvitation[]
        );
      } catch {
        if (cancelled) {
          return;
        }
        setLoadError("We couldn't load this Space. Please try again.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchSpaceDetail(spaceId);

    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  const currentMember = user
    ? members.find((m) => m.user_id === user.id)
    : undefined;
  const isOwner = currentMember?.role === "owner";

  function validateName(value: string): string | undefined {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return "Enter a name for your Space.";
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      return `Keep the name under ${MAX_NAME_LENGTH} characters.`;
    }
    return undefined;
  }

  function validateDescription(value: string): string | undefined {
    if (value.length > MAX_DESCRIPTION_LENGTH) {
      return `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`;
    }
    return undefined;
  }

  function handleStartEdit() {
    setEditName(space?.name ?? "");
    setEditDescription(space?.description ?? "");
    setEditNameError(undefined);
    setEditDescriptionError(undefined);
    setEditFormError(undefined);
    setIsEditing(true);
  }

  function handleCancelEdit() {
    setIsEditing(false);
    setEditNameError(undefined);
    setEditDescriptionError(undefined);
    setEditFormError(undefined);
  }

  async function handleSaveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSavingEdit || !spaceId) {
      return;
    }

    const nextNameError = validateName(editName);
    const nextDescriptionError = validateDescription(editDescription);
    setEditNameError(nextNameError);
    setEditDescriptionError(nextDescriptionError);

    if (nextNameError || nextDescriptionError) {
      return;
    }

    setEditFormError(undefined);
    setIsSavingEdit(true);

    try {
      const { data, error } = await supabase
        .from("spaces")
        .update({
          name: editName.trim(),
          description: editDescription.trim() || null,
        })
        .eq("id", spaceId)
        .select();

      if (error) {
        setEditFormError(mapUpdateError(error));
        return;
      }

      // RLS may return an empty array if the user is not the owner
      // (shouldn't happen — the edit form is only shown to owners). If data
      // is present, update the local state; otherwise just exit edit mode.
      const updatedSpace = (data?.[0] as Space | undefined) ?? null;
      if (updatedSpace) {
        setSpace(updatedSpace);
      }
      setIsEditing(false);
    } catch {
      setEditFormError("We couldn't save your changes. Please try again.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleLeave() {
    if (!spaceId || isLeaving) {
      return;
    }

    setIsLeaving(true);
    setLeaveError(undefined);

    try {
      const { error } = await supabase.rpc("leave_space", {
        p_space_id: spaceId,
      });

      if (error) {
        setLeaveError(mapLeaveError(error));
        return;
      }

      // Success — redirect to the dashboard. The user can't use the back
      // button to return to a Space they've left.
      navigate(AUTHENTICATED_HOME_PATH, { replace: true });
    } catch {
      setLeaveError("We couldn't remove you from this Space. Please try again.");
    } finally {
      setIsLeaving(false);
    }
  }

  async function handleDelete() {
    if (!spaceId || isDeleting) {
      return;
    }

    setIsDeleting(true);
    setDeleteError(undefined);

    try {
      const { error } = await supabase
        .from("spaces")
        .delete()
        .eq("id", spaceId);

      if (error) {
        setDeleteError(mapDeleteError(error));
        return;
      }

      // Success — the Space and all its child data are cascade-deleted.
      // Redirect to the dashboard.
      navigate(AUTHENTICATED_HOME_PATH, { replace: true });
    } catch {
      setDeleteError("We couldn't delete this Space. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  }

  function closeLeaveDialog() {
    if (isLeaving) {
      return;
    }
    setLeaveError(undefined);
    setIsLeaveDialogOpen(false);
  }

  function closeDeleteDialog() {
    if (isDeleting) {
      return;
    }
    setDeleteError(undefined);
    setDeleteConfirmName("");
    setIsDeleteDialogOpen(false);
  }

  function validateInviteEmail(value: string): string | undefined {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return "Enter an email to invite.";
    }
    // Lightweight format check — same regex as the auth pages (auth-design §7).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return "Enter a valid email.";
    }
    return undefined;
  }

  /**
   * Creates a pending invitation for the entered email (spaces-design §7.4).
   *
   * The `token` and `expires_at` columns both have database defaults
   * (`gen_random_uuid()` and `now() + interval '7 days'`), so the client
   * does NOT set them — `token` is returned by the insert's `.select()` and
   * used to build the copyable invite link, and `expires_at` is enforced
   * server-side (spaces-design §1.2 — 7-day expiry). This mirrors the same
   * pattern already used for `token`.
   *
   * Two server-side rejections are mapped to calm messages:
   *  - `23505` from the partial unique index → duplicate pending invite.
   *  - `23505` from the `check_invitation_not_existing_member` trigger →
   *    already a member. The trigger's message distinguishes this case from
   *    the duplicate-pending case (both surface as PostgreSQL `23505`).
   */
  async function handleCreateInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isCreatingInvite || !spaceId || !user) {
      return;
    }

    const nextEmailError = validateInviteEmail(inviteEmail);
    setInviteEmailError(nextEmailError);
    if (nextEmailError) {
      return;
    }

    setInviteFormError(undefined);
    setIsCreatingInvite(true);

    try {
      const trimmedEmail = inviteEmail.trim();
      const { data, error } = await supabase
        .from("space_invitations")
        .insert({
          space_id: spaceId,
          email: trimmedEmail,
          invited_by: user.id,
          role: "member", // always 'member' for Phase 2 (spaces-design §10.7)
          status: "pending",
          // `token` and `expires_at` are omitted — both have database
          // defaults (gen_random_uuid() and now() + interval '7 days').
        })
        .select()
        .single();

      if (error) {
        setInviteFormError(mapInviteError(error));
        return;
      }

      // Success — build the copyable invite link and prepend the new
      // invitation to the local list so it appears immediately.
      const created = data as SpaceInvitation;
      const link = `${window.location.origin}${inviteAcceptPath(created.token)}`;
      setCreatedInviteLink(link);
      setIsInviteLinkCopied(false);
      setInvitations((prev) => [created, ...prev]);
      setInviteEmail("");
      setInviteEmailError(undefined);
    } catch {
      setInviteFormError(
        "We couldn't create the invite link. Please try again."
      );
    } finally {
      setIsCreatingInvite(false);
    }
  }

  /**
   * Copies the most recently created invite link to the clipboard. Falls
   * back to a non-fatal error message if the Clipboard API is unavailable
   * or rejects (e.g. insecure context, permissions). The "Copied"
   * confirmation resets after a short delay.
   */
  async function handleCopyInviteLink() {
    if (!createdInviteLink || isInviteLinkCopied) {
      return;
    }

    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(createdInviteLink);
      } else {
        // Legacy / insecure-context fallback. Selecting a hidden input is
        // the most portable pre-Clipboard-API approach.
        const textarea = document.createElement("textarea");
        textarea.value = createdInviteLink;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setIsInviteLinkCopied(true);
      window.setTimeout(() => setIsInviteLinkCopied(false), 2000);
    } catch {
      setInviteFormError(
        "Couldn't copy the link automatically. Select it and copy manually."
      );
    }
  }

  return (
    <>
      <div className="mb-6">
        <GhostLink to={spaceId ? spaceDetailPath(spaceId) : AUTHENTICATED_HOME_PATH}>
          Back to Space
        </GhostLink>
      </div>

      {isLoading ? (
        <div
          className="flex items-center justify-center py-24 text-accent-400"
          role="status"
          aria-live="polite"
        >
          <Spinner size={28} />
        </div>
      ) : notFound ? (
        <div className="py-16 text-center">
          <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
            Space not found
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-ink-muted sm:text-base">
            This Space may have been deleted, or you may not have access to it.
          </p>
          <div className="mt-8">
            <GhostLink to={AUTHENTICATED_HOME_PATH}>Back to Spaces</GhostLink>
          </div>
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-ink/5 bg-canvas-soft p-6 text-center">
          <p className="text-sm text-error">{loadError}</p>
        </div>
      ) : space ? (
        <main className="w-full max-w-[600px] mx-auto px-4 md:px-0 py-8 md:py-12 flex flex-col gap-8 md:gap-12">
          {/* Page Header */}
          <div className="flex flex-col gap-6">
            <a
              className="inline-flex items-center gap-2 text-on-surface-variant dark:text-surface-container-lowest/80 hover:text-accent-warm dark:hover:text-primary-fixed-dim transition-colors font-body-sm text-body-sm w-fit group"
              href={spaceId ? spaceDetailPath(spaceId) : AUTHENTICATED_HOME_PATH}
            >
              <span className="material-symbols-outlined text-[18px] group-hover:-translate-x-1 transition-transform">
                arrow_back
              </span>
              Back to Space
            </a>
            <div className="flex items-center justify-between">
              {isEditing ? (
                <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface dark:text-surface-container-lowest">
                  Edit Space
                </h1>
              ) : (
                <>
                  <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface dark:text-surface-container-lowest">
                    {space.name}
                  </h1>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={handleStartEdit}
                      className="text-accent-warm dark:text-primary-fixed-dim hover:opacity-80 transition-opacity font-body-sm text-body-sm font-medium"
                    >
                      Edit
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Edit Mode Form */}
          {isEditing && (
            <section>
              <form
                className="max-w-[420px] space-y-5 rounded-xl border border-outline-variant/30 dark:border-outline-variant/20 bg-card-warm dark:bg-card-dark p-6 shadow-stone transition-colors duration-300"
                onSubmit={handleSaveEdit}
                noValidate
                aria-describedby={
                  editFormError ? "edit-space-form-error" : undefined
                }
              >
                <TextField
                  id="edit-name"
                  name="name"
                  type="text"
                  label="Space name"
                  autoComplete="off"
                  maxLength={MAX_NAME_LENGTH}
                  value={editName}
                  disabled={isSavingEdit}
                  error={editNameError}
                  onChange={(event) => setEditName(event.target.value)}
                  onBlur={() => setEditNameError(validateName(editName))}
                />
                <TextField
                  id="edit-description"
                  name="description"
                  type="text"
                  label="Description"
                  helperText="Optional"
                  maxLength={MAX_DESCRIPTION_LENGTH}
                  value={editDescription}
                  disabled={isSavingEdit}
                  error={editDescriptionError}
                  onChange={(event) => setEditDescription(event.target.value)}
                  onBlur={() =>
                    setEditDescriptionError(validateDescription(editDescription))
                  }
                />
                {editFormError && (
                  <p
                    id="edit-space-form-error"
                    role="alert"
                    className="text-sm text-error"
                  >
                    {editFormError}
                  </p>
                )}
                <div className="flex items-center gap-4">
                  <PrimaryButton
                    type="submit"
                    loading={isSavingEdit}
                    disabled={isSavingEdit}
                  >
                    {isSavingEdit ? "Saving…" : "Save changes"}
                  </PrimaryButton>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    disabled={isSavingEdit}
                    className="rounded-md text-sm font-medium text-ink-muted transition-colors duration-200 hover:text-accent-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* View Mode - Space Description */}
          {!isEditing && space.description && (
            <p className="font-body-sm text-body-sm text-on-surface-variant dark:text-surface-container-lowest/80">
              {space.description}
            </p>
          )}

          {/* Members Section */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <h2 className="font-headline-md text-headline-md text-on-surface dark:text-surface-container-lowest font-medium">
                Members
              </h2>
              <span className="font-mono-label text-mono-label bg-surface-container-highest dark:bg-inverse-surface text-on-surface-variant dark:text-surface-container-lowest/80 px-2 py-0.5 rounded-full">
                {members.length}
              </span>
            </div>
            <div className="bg-card-warm dark:bg-card-dark rounded-lg shadow-stone border border-outline-variant/30 dark:border-outline-variant/20 overflow-hidden transition-colors duration-300">
              <ul className="divide-y divide-outline-variant/30 dark:divide-outline-variant/20">
                {members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isCurrentUser={member.user_id === user?.id}
                  />
                ))}
              </ul>
            </div>
          </section>

          {/* Invite Section (owner only) */}
          {isOwner && (
            <section className="flex flex-col gap-6 pt-4">
              <div className="flex flex-col gap-2">
                <h2 className="font-headline-md text-headline-md text-on-surface dark:text-surface-container-lowest font-medium">
                  Invite
                </h2>
                <p className="font-body-sm text-body-sm text-on-surface-variant dark:text-surface-container-lowest/80 max-w-md">
                  Create a link to invite someone to this Space by email. Links
                  expire after 7 days.
                </p>
              </div>

              <form
                className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-start"
                onSubmit={handleCreateInvite}
                noValidate
                aria-describedby={
                  inviteFormError ? "invite-form-error" : undefined
                }
              >
                <div className="flex-grow flex flex-col gap-1">
                  <input
                    id="invite-email"
                    name="email"
                    type="email"
                    autoComplete="off"
                    inputMode="email"
                    placeholder="you@example.com"
                    required
                    value={inviteEmail}
                    disabled={isCreatingInvite}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    onBlur={() =>
                      setInviteEmailError(validateInviteEmail(inviteEmail))
                    }
                    className="w-full bg-card-warm dark:bg-inverse-surface border-b-2 border-transparent focus:border-accent-warm dark:focus:border-primary-fixed-dim rounded-t-DEFAULT shadow-stone px-4 py-3 font-body-md text-body-md text-on-surface dark:text-surface-container-lowest placeholder-on-surface-variant/50 dark:placeholder:text-surface-container-lowest/40 focus:outline-none transition-all duration-200"
                  />
                  {inviteEmailError && (
                    <p className="text-sm text-error">{inviteEmailError}</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={isCreatingInvite}
                  className="bg-accent-warm dark:bg-primary-fixed-dim text-canvas-warm dark:text-on-primary-fixed px-6 py-3 rounded hover:opacity-90 active:scale-95 transition-all duration-200 font-body-md text-body-md whitespace-nowrap shadow-sm hover:-translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCreatingInvite ? "Creating…" : "Create Invite Link"}
                </button>
              </form>

              {inviteFormError && (
                <p id="invite-form-error" role="alert" className="text-sm text-error">
                  {inviteFormError}
                </p>
              )}

              {/* Generated invite link — shown after a successful insert. */}
              {createdInviteLink && (
                <div className="mt-5 max-w-[420px] rounded-lg border border-outline-variant/30 dark:border-outline-variant/20 bg-card-warm dark:bg-card-dark p-4 shadow-stone transition-colors duration-300">
                  <p className="font-body-sm text-body-sm font-medium text-on-surface dark:text-surface-container-lowest">
                    Invite link ready
                  </p>
                  <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant dark:text-surface-container-lowest/80">
                    Share this link with the person you invited. They can use
                    it to accept the invitation.
                  </p>
                  <code className="mt-3 block break-all rounded-md bg-canvas dark:bg-canvas-raised px-3 py-2 text-xs text-on-surface-variant dark:text-surface-container-lowest/80 font-mono">
                    {createdInviteLink}
                  </code>
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleCopyInviteLink}
                      disabled={isInviteLinkCopied}
                      className="bg-accent-warm dark:bg-primary-fixed-dim text-canvas-warm dark:text-on-primary-fixed px-4 py-2 rounded hover:opacity-90 active:scale-95 transition-all duration-200 font-body-md text-body-sm whitespace-nowrap shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isInviteLinkCopied ? "Copied!" : "Copy Link"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreatedInviteLink(null);
                        setIsInviteLinkCopied(false);
                      }}
                      className="rounded-md font-body-sm text-body-sm font-medium text-on-surface-variant dark:text-surface-container-lowest/80 transition-colors duration-200 hover:text-accent-warm dark:hover:text-primary-fixed-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Pending invites already sent for this Space. */}
              <div className="pt-4 border-t border-outline-variant/30 dark:border-outline-variant/20">
                <h3 className="font-body-sm text-body-sm font-medium text-on-surface dark:text-surface-container-lowest">
                  Pending invites
                </h3>
                {invitations.length === 0 ? (
                  <p className="mt-2 font-body-sm text-body-sm text-on-surface-variant dark:text-surface-container-lowest/60 italic">
                    No pending invites for this Space.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-outline-variant/30 dark:divide-outline-variant/20">
                    {invitations.map((invitation) => (
                      <li
                        key={invitation.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-body-sm text-body-sm font-medium text-on-surface dark:text-surface-container-lowest">
                            {invitation.email}
                          </p>
                          <p className="font-mono-data text-mono-data text-on-surface-variant dark:text-surface-container-lowest/60">
                            {formatExpiry(invitation.expires_at)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {/* Danger zone */}
          <section className="mt-8 pt-8 border-t border-error/20 dark:border-error-container/20">
            <div className="bg-surface-bright dark:bg-card-dark rounded-lg border border-error/30 dark:border-error-container/30 p-6 flex flex-col sm:flex-row gap-6 items-start sm:items-center justify-between shadow-stone transition-colors duration-300">
              <div className="flex flex-col gap-2 flex-grow">
                <h2 className="font-headline-md text-headline-md text-error dark:text-error-container font-medium">
                  Danger zone
                </h2>
                <p className="font-body-sm text-body-sm text-on-surface-variant dark:text-surface-container-lowest/80 max-w-sm">
                  {isOwner
                    ? "Deleting a Space permanently removes it and all of its memories. This can't be undone."
                    : "Leaving a Space removes your access to it and its memories. This can't be undone."}
                </p>
              </div>
              {isOwner ? (
                <button
                  type="button"
                  onClick={() => setIsDeleteDialogOpen(true)}
                  className="px-5 py-2.5 rounded border border-error dark:border-error-container text-error dark:text-error-container hover:bg-error/5 dark:hover:bg-error-container/10 active:scale-95 transition-all duration-200 font-body-sm text-body-sm font-medium whitespace-nowrap"
                >
                  Delete Space
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsLeaveDialogOpen(true)}
                  className="px-5 py-2.5 rounded border border-error dark:border-error-container text-error dark:text-error-container hover:bg-error/5 dark:hover:bg-error-container/10 active:scale-95 transition-all duration-200 font-body-sm text-body-sm font-medium whitespace-nowrap"
                >
                  Leave Space
                </button>
              )}
            </div>
          </section>
        </main>

      ) : null}

      {/* Leave confirmation (member) - uses default ConfirmDialog variant */}
      {isLeaveDialogOpen && (
        <ConfirmDialog
          title="Leave Space?"
          description="You'll no longer have access to this Space or its memories. This can't be undone."
          confirmLabel="Leave Space"
          loading={isLeaving}
          onConfirm={handleLeave}
          onCancel={closeLeaveDialog}
        >
          {leaveError && (
            <p role="alert" className="text-sm text-error">
              {leaveError}
            </p>
          )}
        </ConfirmDialog>
      )}

      {/* Delete confirmation (owner) — typed-name confirmation with Stitch delete variant */}
      {isDeleteDialogOpen && space && (
        <ConfirmDialog
          title="Delete Space?"
          description="This permanently deletes this Space and all of its memories. This action cannot be undone."
          confirmLabel="Delete Space"
          loading={isDeleting}
          confirmDisabled={!isDeleteNameMatched}
          onConfirm={handleDelete}
          onCancel={closeDeleteDialog}
          variant="delete"
        >
          <StitchTextField
            id="delete-confirm-name"
            name="delete-confirm-name"
            type="text"
            label="Type the space name to confirm"
            autoComplete="off"
            placeholder={space.name}
            value={deleteConfirmName}
            disabled={isDeleting}
            onChange={(event) => setDeleteConfirmName(event.target.value)}
          />
          {deleteError && (
            <p role="alert" className="mt-3 text-sm text-error">
              {deleteError}
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * Maps a `leave_space()` RPC error to a calm, human-friendly message
 * (auth-design §7 voice). The RPC raises specific error codes for each
 * rejection case (see migration 20260705190000_invitation_security.sql §4).
 */
function mapLeaveError(error: { code?: string }): string {
  switch (error.code) {
    case "55000": // object_not_prerequisite_state — last owner or last member
      return "You're the only member of this Space, so it can't be left empty.";
    case "P0002": // no_data_found — not a member of this space
      return "You're not a member of this Space.";
    case "42501": // insufficient_privilege — not authenticated
      return "You must be signed in to leave a Space.";
    default:
      return "We couldn't remove you from this Space. Please try again.";
  }
}

/**
 * Maps a Space delete error to a calm message. The `spaces_delete` RLS
 * policy requires `is_space_owner(id)`; a non-owner delete resolves to an
 * empty result rather than a thrown error, so this mapping covers the
 * remaining failure cases.
 */
function mapDeleteError(error: { code?: string }): string {
  switch (error.code) {
    case "42501": // insufficient_privilege — RLS denied
      return "You can't delete this Space. Only the owner can delete it.";
    default:
      return "We couldn't delete this Space. Please try again.";
  }
}

/**
 * Maps a Space update error to a calm message. The `spaces_update` RLS
 * policy requires `is_space_owner(id)`; a non-owner update resolves to an
 * empty result, so this mapping covers the remaining failure cases.
 */
function mapUpdateError(error: { code?: string }): string {
  switch (error.code) {
    case "42501": // insufficient_privilege — RLS denied
      return "You can't edit this Space. Only the owner can change its details.";
    default:
      return "We couldn't save your changes. Please try again.";
  }
}

/**
 * Maps a `space_invitations` insert error to a calm, human-friendly message
 * (spaces-design §6.4 error mapping).
 *
 * Two server-side rejections both surface as PostgreSQL `23505`
 * (`unique_violation`):
 *  - The partial unique index `uq_space_invitations_pending_email` blocks a
 *    duplicate pending invite for the same `(space_id, email)`.
 *  - The `check_invitation_not_existing_member` BEFORE INSERT trigger
 *    blocks inviting an email that is already a member. The trigger raises
 *    with the message "This person is already a member of this space."
 *
 * They are distinguished by the error message (the trigger sets an explicit
 * message; the index violation carries a generic constraint message). Any
 * other `23505` is treated as the duplicate-pending case, which is the
 * safer default since the partial index is the only other `23505` source on
 * this insert path.
 */
function mapInviteError(error: {
  code?: string;
  message?: string;
}): string {
  if (error.code === "23505") {
    // unique_violation — either the partial index or the member-check trigger
    if (
      typeof error.message === "string" &&
      error.message.includes("already a member")
    ) {
      return "This person is already a member of this space.";
    }
    return "An invite is already pending for this email.";
  }

  if (error.code === "42501") {
    // insufficient_privilege — RLS denied (not the owner)
    return "Only the owner of this Space can send invites.";
  }

  return "We couldn't create the invite link. Please try again.";
}

/**
 * Formats an invitation's `expires_at` for the pending-invites list.
 *
 * Returns a short, human-readable expiry label. Past dates (an invitation
 * that has expired but not yet been cleaned up) render as "expired" so the
 * list never shows a misleading future-looking date for a stale row.
 *
 * Uses `Date#toLocaleDateString` for a locale-aware, concise date. No time
 * component — an invite's expiry day is what matters, not the exact minute.
 */
function formatExpiry(expiresAt: string): string {
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) {
    return "on an unknown date";
  }
  if (expiry.getTime() <= Date.now()) {
    return "Expired";
  }
  return `Expires on ${expiry.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}