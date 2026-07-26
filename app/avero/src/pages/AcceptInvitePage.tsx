import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import AuthShell from "../components/auth/AuthShell";
import AuthFormPanel from "../components/auth/AuthFormPanel";
import AuthHeading from "../components/auth/AuthHeading";
import PrimaryButton from "../components/ui/PrimaryButton";
import GhostLink from "../components/ui/GhostLink";
import Spinner from "../components/ui/Spinner";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  spaceDetailPath,
} from "../constants/routes";

/**
 * The invitation details returned by the `get_invitation_by_token` RPC
 * (migration 20260705260000). The function is SECURITY DEFINER and grants
 * anon + authenticated execution, so anyone holding the unguessable token
 * can look up basic invitation info (space name, status, expiry) without
 * being a Space member or even signed in — the token itself is the capability.
 */
type InvitationDetails = {
  space_name: string;
  status: string;
  expires_at: string;
};

/**
 * Accept Invite screen — the landing page for invitation links
 * (spaces-design §6.5).
 *
 * Route: `/invite/:token` — public (not wrapped in `ProtectedRoute` or
 * `PublicOnlyRoute`), because the invitee may not have an account yet.
 *
 * State flow (in order):
 *  1. Invitation fetch loading → Spinner.
 *  2. Fetch errored / no data / token undefined → "not found" state.
 *  3. Invitation found → narrow to non-null via a combined check.
 *  4. Status not 'pending' or expired → "no longer available" state.
 *  5. Auth still resolving → Spinner.
 *  6. User logged in → "Accept" state with PrimaryButton calling
 *     `accept_space_invitation(p_token)`.
 *  7. User not logged in → "Sign in / create account" state with GhostLinks.
 *
 * The invitation is fetched via the `get_invitation_by_token` RPC, which
 * returns the space name, status, and expiry. Acceptance is handled by the
 * `accept_space_invitation` RPC (migration 20260705190000 §3), which
 * atomically validates the invitation, inserts the membership, and updates
 * the status.
 */
export default function AcceptInvitePage() {
  const { token } = useParams();
  const { user, isLoading: isAuthLoading } = useAuth();
  const navigate = useNavigate();

  // Invitation fetch state. The combined `fetchError || !invitationData`
  // check in render narrows `invitationData` to non-null in a single step,
  // avoiding separate loading/notFound booleans that need extra guards.
  //
  // Lazy initial state derived from `token`: when the token is absent (an
  // unreachable branch in practice — React Router guarantees :token is
  // present for the /invite/:token route), the page starts directly in the
  // "not found" state without needing a synchronous setState in the effect
  // (react-hooks/set-state-in-effect).
  const [isLoading, setIsLoading] = useState(() => Boolean(token));
  const [fetchError, setFetchError] = useState(() => !token);
  const [invitationData, setInvitationData] = useState<InvitationDetails | null>(
    null
  );

  // Accept state (STATE 3 only).
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!token) {
      // No token — can't fetch. The lazy initial state already set
      // isLoading=false and fetchError=true, so render shows STATE 1
      // without a synchronous setState here (react-hooks/set-state-in-effect).
      return;
    }

    let cancelled = false;

    async function fetchInvitation(t: string) {
      setIsLoading(true);
      setFetchError(false);

      try {
        const { data, error } = await supabase
          .rpc("get_invitation_by_token", { p_token: t })
          .single();

        if (cancelled) {
          return;
        }

        if (error || !data) {
          setFetchError(true);
          return;
        }

        setInvitationData(data as InvitationDetails);
      } catch {
        if (!cancelled) {
          setFetchError(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchInvitation(token);

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAccept(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || isAccepting) {
      return;
    }

    setAcceptError(undefined);
    setIsAccepting(true);

    try {
      const { data, error } = await supabase.rpc("accept_space_invitation", {
        p_token: token,
      });

      if (error) {
        setAcceptError(mapAcceptError(error));
        return;
      }

      // Success — navigate to the Space detail page. `replace: true` so the
      // user can't navigate back to the now-accepted invitation.
      navigate(spaceDetailPath(data as string), { replace: true });
    } catch {
      setAcceptError("Something went wrong. Please try again.");
    } finally {
      setIsAccepting(false);
    }
  }

  // STATE 1 (loading) — invitation fetch in progress.
  if (isLoading) {
    return (
      <AuthShell ambientCopy="A private home for the moments that matter.">
        <AuthFormPanel>
          <div
            className="flex items-center justify-center py-24 text-accent-400"
            role="status"
            aria-live="polite"
          >
            <Spinner size={28} />
          </div>
        </AuthFormPanel>
      </AuthShell>
    );
  }

  // STATE 1 (not found) — fetch errored, returned no data, or token missing.
  // The combined check narrows `invitationData` to non-null for all
  // subsequent states.
  if (fetchError || !invitationData) {
    return (
      <AuthShell ambientCopy="A private home for the moments that matter.">
        <AuthFormPanel>
          <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
            This invitation could not be found.
          </h1>
          <div className="mt-8">
            <GhostLink to={SIGN_IN_PATH}>Back to sign in</GhostLink>
          </div>
        </AuthFormPanel>
      </AuthShell>
    );
  }

  const invitation = invitationData;

  // STATE 2 (no longer available) — already used, cancelled, or expired.
  // The expiry check is delegated to a module-level helper so `Date.now()`
  // is not called directly in the render body (react-hooks/purity) — same
  // pattern as SpaceDetailPage's `formatExpiry`.
  if (
    invitation.status !== "pending" ||
    isInvitationExpired(invitation.expires_at)
  ) {
    return (
      <AuthShell ambientCopy="A private home for the moments that matter.">
        <AuthFormPanel>
          <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
            This invitation is no longer available.
          </h1>
          <div className="mt-8">
            <GhostLink to={SIGN_IN_PATH}>Back to sign in</GhostLink>
          </div>
        </AuthFormPanel>
      </AuthShell>
    );
  }

  // STATE 5 (auth resolving) — wait for the AuthProvider to finish before
  // deciding between STATE 3 (logged in) and STATE 4 (not logged in).
  if (isAuthLoading) {
    return (
      <AuthShell ambientCopy="A private home for the moments that matter.">
        <AuthFormPanel>
          <div
            className="flex items-center justify-center py-24 text-accent-400"
            role="status"
            aria-live="polite"
          >
            <Spinner size={28} />
          </div>
        </AuthFormPanel>
      </AuthShell>
    );
  }

  // STATE 4 (not logged in) — invitee needs to sign in or create an account.
  if (!user) {
    return (
      <AuthShell ambientCopy="A private home for the moments that matter.">
        <AuthFormPanel>
          <AuthHeading
            headline={`You've been invited to join '${invitation.space_name}'.`}
            supportingLine="Sign in or create an account to accept this invite."
            className="mb-8"
          />
          <div className="flex flex-col items-center gap-4">
            <GhostLink to={SIGN_IN_PATH}>Sign in</GhostLink>
            <GhostLink to={SIGN_UP_PATH}>Create an account</GhostLink>
          </div>
        </AuthFormPanel>
      </AuthShell>
    );
  }

  // STATE 3 (logged in) — show the invitation details and Accept button.
  return (
    <AuthShell ambientCopy="A private home for the moments that matter.">
      <AuthFormPanel>
        <AuthHeading
          headline={`You've been invited to join '${invitation.space_name}'.`}
          supportingLine="Accept to join this Space."
          className="mb-8"
        />
        <form
          className="space-y-5"
          onSubmit={handleAccept}
          noValidate
          aria-describedby={acceptError ? "accept-invite-error" : undefined}
        >
          {acceptError && (
            <p
              id="accept-invite-error"
              role="alert"
              className="text-sm text-error"
            >
              {acceptError}
            </p>
          )}
          <PrimaryButton type="submit" loading={isAccepting}>
            {isAccepting ? "Accepting…" : "Accept"}
          </PrimaryButton>
        </form>
      </AuthFormPanel>
    </AuthShell>
  );
}

/**
 * Returns whether an invitation's `expires_at` is in the past.
 *
 * Kept as a module-level helper so `Date.now()` is not called directly in
 * the component render body (react-hooks/purity). Mirrors the pattern used
 * by SpaceDetailPage's `formatExpiry`.
 */
function isInvitationExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

/**
 * Maps an `accept_space_invitation` RPC error to a calm, human-friendly
 * message (auth-design §7 voice). The RPC raises specific PostgreSQL error
 * codes for each rejection case (migration 20260705190000 §3):
 *
 *  - P0002 (no_data_found) — invitation not found.
 *  - 42501 (insufficient_privilege) — not authenticated, or the signed-in
 *    user's email does not match the invitation's email.
 *  - 55000 (object_not_in_prerequisite_state) — already used/cancelled, or
 *    expired. Distinguished by the error message.
 */
function mapAcceptError(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case "P0002":
      return "This invitation could not be found.";
    case "42501":
      return "This invite was sent to a different email address. Please sign in with the correct account.";
    case "55000":
      if (
        typeof error.message === "string" &&
        error.message.includes("expired")
      ) {
        return "This invitation has expired.";
      }
      return "This invitation has already been used or cancelled.";
    default:
      return "Something went wrong. Please try again.";
  }
}
