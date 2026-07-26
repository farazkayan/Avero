import { useEffect, useState } from "react";
import AuthShell from "../components/auth/AuthShell";
import AuthFormPanel from "../components/auth/AuthFormPanel";
import AuthHeading from "../components/auth/AuthHeading";
import AuthLoadingScreen from "../components/auth/AuthLoadingScreen";
import PasswordField from "../components/ui/PasswordField";
import PrimaryButton from "../components/ui/PrimaryButton";
import GhostLink from "../components/ui/GhostLink";
import { supabase } from "../lib/supabase";
import { SIGN_IN_PATH, FORGOT_PASSWORD_PATH } from "../constants/routes";

/**
 * Minimum password length enforced by Avero (auth-design §7).
 *
 * Mirrors the constant in [`SignUpPage.tsx`](./SignUpPage.tsx) so the same
 * rule is enforced at signup and at reset. Kept local rather than shared to
 * avoid coupling these two pages — each remains a focused, self-contained
 * screen (ai-context §3: Keep Components Focused).
 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * How long to wait for a PASSWORD_RECOVERY event before concluding the link
 * is invalid or expired (auth-design §3.3, §7).
 *
 * The recovery token exchange is a local background operation performed by
 * the Supabase client SDK — not a slow network request — so a few seconds
 * is plenty. If no PASSWORD_RECOVERY event arrives within this window, the
 * link is treated as invalid or expired.
 */
const RECOVERY_TIMEOUT_MS = 5000;

type SessionStatus = "checking" | "valid" | "invalid";

/**
 * Reset Password screen — the "set new password" step of recovery
 * (auth-design §3.3, §4, §7).
 *
 * The user only reaches this screen by clicking the link in the recovery
 * email. Supabase's client SDK exchanges the token in that link for a
 * temporary recovery session and emits a PASSWORD_RECOVERY event. This
 * screen subscribes to `onAuthStateChange` and waits for that event before
 * showing the password form:
 *
 * - PASSWORD_RECOVERY event → show the new password form.
 * - No event within a short timeout → show a calm "invalid or expired link"
 *   message with a path to request a new one (auth-design §7). The form is
 *   never shown in this state.
 *
 * A generic SIGNED_IN event or a pre-existing session is intentionally NOT
 * treated as sufficient to show the form — only PASSWORD_RECOVERY unlocks
 * it. This closes the gap where an already-logged-in user visiting
 * /reset-password directly would incorrectly see the form.
 *
 * On submit, `supabase.auth.updateUser({ password })` updates the password
 * against the recovery session. On success the temporary recovery session is
 * signed out (the user should not remain logged in via the recovery token),
 * and the user is redirected to sign in.
 */
export default function ResetPasswordPage() {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("checking");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>(
    undefined
  );
  const [confirmPasswordError, setConfirmPasswordError] = useState<
    string | undefined
  >(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // When set, the form is replaced by the success confirmation and the user
  // is redirected to sign in.
  const [isComplete, setIsComplete] = useState(false);

  // Subscribe to Supabase auth state changes and wait for a PASSWORD_RECOVERY
  // event, which fires when the client SDK exchanges the recovery token from
  // the email link. Only this event unlocks the reset form — a generic
  // SIGNED_IN event or a pre-existing session is intentionally NOT treated
  // as sufficient, so an already-logged-in user visiting /reset-password
  // directly does not see the form (auth-design §3.3, §7).
  //
  // A short timeout acts as the fallback: if no PASSWORD_RECOVERY event
  // arrives in time, the link is treated as invalid or expired.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setSessionStatus("valid");
      }
    });

    const timeout = setTimeout(() => {
      setSessionStatus((current) =>
        current === "checking" ? "invalid" : current
      );
    }, RECOVERY_TIMEOUT_MS);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  function validatePassword(value: string): string | undefined {
    if (value.length === 0) {
      return "Enter a password.";
    }
    if (value.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    return undefined;
  }

  function validateConfirmPassword(value: string): string | undefined {
    if (value.length === 0) {
      return "Confirm your password.";
    }
    if (value !== password) {
      return "Passwords don't match.";
    }
    return undefined;
  }

  function handlePasswordBlur() {
    setPasswordError(validatePassword(password));
  }

  function handleConfirmPasswordBlur() {
    setConfirmPasswordError(validateConfirmPassword(confirmPassword));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Prevent duplicate submissions while a request is in flight.
    if (isSubmitting) {
      return;
    }

    const nextPasswordError = validatePassword(password);
    const nextConfirmPasswordError = validateConfirmPassword(confirmPassword);
    setPasswordError(nextPasswordError);
    setConfirmPasswordError(nextConfirmPasswordError);

    if (nextPasswordError || nextConfirmPasswordError) {
      return;
    }

    setFormError(undefined);
    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setFormError(mapResetPasswordError(error));
        return;
      }

      // Success: sign out the temporary recovery session so the user is not
      // left logged in via the recovery token, then redirect to sign in.
      await supabase.auth.signOut();
      setIsComplete(true);
    } catch {
      setFormError("Something went wrong on our end. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // While the recovery session is being resolved, show the calm loading
  // screen so the user never sees an ambiguous blank state (auth-design §7).
  if (sessionStatus === "checking") {
    return <AuthLoadingScreen />;
  }

  // No valid recovery session — the link is invalid or expired. Show a calm
  // message and a path to request a new link. The form is never shown in
  // this state (auth-design §3.3, §7).
  if (sessionStatus === "invalid") {
    return (
      <AuthShell ambientCopy="A private home for the moments that matter.">
        <AuthFormPanel>
          <AuthHeading
            headline="This link is invalid or has expired."
            supportingLine="Reset links can only be used once and expire after a short time."
            className="mb-8"
          />

          <p className="text-sm text-ink-muted">
            Request a new link and we'll send it to your inbox.
          </p>

          <p className="mt-8 text-center text-sm text-ink-muted">
            <GhostLink to={FORGOT_PASSWORD_PATH}>
              Request a new link.
            </GhostLink>
          </p>
        </AuthFormPanel>
      </AuthShell>
    );
  }

  // Success confirmation — replaces the form after the password is updated.
  // The recovery session has already been signed out; the user is redirected
  // to sign in with their new password.
  if (isComplete) {
    return (
      <AuthShell ambientCopy="A private home for the moments that matter.">
        <AuthFormPanel>
          <AuthHeading
            headline="Your password has been updated."
            supportingLine="Sign in with your new password to continue."
            className="mb-8"
          />

          <p className="mt-8 text-center text-sm text-ink-muted">
            <GhostLink to={SIGN_IN_PATH}>Continue to sign in.</GhostLink>
          </p>
        </AuthFormPanel>
      </AuthShell>
    );
  }

  return (
    <AuthShell ambientCopy="A private home for the moments that matter.">
      <AuthFormPanel>
        <AuthHeading
          headline="Choose a new password."
          supportingLine="Set a new password to secure your account."
          className="mb-8"
        />

        <form
          className="space-y-5"
          onSubmit={handleSubmit}
          noValidate
          aria-describedby={
            formError ? "reset-password-form-error" : undefined
          }
        >
          <PasswordField
            id="password"
            name="password"
            label="New password"
            autoComplete="new-password"
            placeholder="Create a password"
            helperText={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            value={password}
            disabled={isSubmitting}
            error={passwordError}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={handlePasswordBlur}
          />

          <PasswordField
            id="confirm-password"
            name="confirm-password"
            label="Confirm password"
            autoComplete="new-password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            disabled={isSubmitting}
            error={confirmPasswordError}
            onChange={(event) => setConfirmPassword(event.target.value)}
            onBlur={handleConfirmPasswordBlur}
          />

          {formError && (
            <p
              id="reset-password-form-error"
              role="alert"
              className="text-sm text-error"
            >
              {formError}
            </p>
          )}

          <PrimaryButton type="submit" loading={isSubmitting}>
            {isSubmitting ? "Updating password…" : "Update password"}
          </PrimaryButton>
        </form>
      </AuthFormPanel>
    </AuthShell>
  );
}

/**
 * Maps a Supabase auth error to a calm, human-friendly message
 * (auth-design §7). Raw Supabase error messages are never shown to users.
 *
 * The `error` returned by `updateUser` is typed by the SDK as
 * `AuthError | null`, which exposes a `code` property for specific cases.
 */
function mapResetPasswordError(error: {
  code?: string;
  status?: number;
}): string {
  switch (error.code) {
    case "weak_password":
      // Supabase rejected the password for being too weak.
      return `Choose a stronger password. Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    case "same_password":
      // Supabase rejected the new password because it matches the current one.
      return "That matches your current password. Please choose a different one.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many attempts. Please wait a moment and try again.";
    case "request_timeout":
      return "The request took too long. Check your connection and try again.";
    default:
      // Network problems, unexpected failures, and any unmapped codes all
      // resolve to the same calm, honest message (auth-design §7).
      return "Something went wrong on our end. Please try again.";
  }
}
