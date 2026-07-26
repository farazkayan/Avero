import { useState } from "react";
import AuthShell from "../components/auth/AuthShell";
import AuthFormPanel from "../components/auth/AuthFormPanel";
import AuthHeading from "../components/auth/AuthHeading";
import TextField from "../components/ui/TextField";
import PrimaryButton from "../components/ui/PrimaryButton";
import GhostLink from "../components/ui/GhostLink";
import { supabase } from "../lib/supabase";
import { RESET_PASSWORD_PATH } from "../constants/routes";

/**
 * Forgot Password screen — initiates the password recovery flow
 * (auth-design §3.3, §4, §7).
 *
 * A single email field triggers `supabase.auth.resetPasswordForEmail`, which
 * sends a recovery link to the user's inbox. The link lands them on the Reset
 * Password screen (see [`ResetPasswordPage.tsx`](./ResetPasswordPage.tsx)),
 * where Supabase exchanges the token for a temporary recovery session.
 *
 * SECURITY: The same calm confirmation is shown regardless of whether the
 * email exists in the system, to prevent account enumeration (auth-design
 * §3.3; ai-context §10). Only rate-limit and network errors are surfaced —
 * neither reveals whether an account exists.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // When set, the form is replaced by the recovery confirmation notice
  // (auth-design §3.3).
  const [isSent, setIsSent] = useState(false);

  function validateEmail(value: string): string | undefined {
    if (value.trim().length === 0) {
      return "Enter your email.";
    }
    // Lightweight format check — no validation library (auth-design §7).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      return "Enter a valid email.";
    }
    return undefined;
  }

  function handleEmailBlur() {
    setEmailError(validateEmail(email));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Prevent duplicate submissions while a request is in flight.
    if (isSubmitting) {
      return;
    }

    const nextEmailError = validateEmail(email);
    setEmailError(nextEmailError);

    if (nextEmailError) {
      return;
    }

    setFormError(undefined);
    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          // The recovery link returns the user to the Reset Password screen,
          // where Supabase exchanges the token for a temporary session.
          redirectTo: `${window.location.origin}${RESET_PASSWORD_PATH}`,
        }
      );

      if (error) {
        // Rate-limit errors are safe to surface — they reveal nothing about
        // whether an account exists, only that too many requests were made.
        if (
          error.code === "over_request_rate_limit" ||
          error.code === "over_email_send_rate_limit"
        ) {
          setFormError("Too many attempts. Please wait a moment and try again.");
          return;
        }
        // Any other error (including "user not found" if the project is
        // configured to return it) is treated as success to avoid account
        // enumeration (auth-design §3.3; ai-context §10).
      }

      // Show the same calm confirmation regardless of whether the email
      // exists (auth-design §3.3). This prevents account enumeration.
      setIsSent(true);
    } catch {
      // Network failures — safe to surface, they don't reveal account
      // existence (auth-design §7).
      setFormError("Something went wrong on our end. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Recovery confirmation — replaces the form after a successful request
  // (auth-design §3.3). No form, one clear next step in the user's inbox.
  if (isSent) {
    return (
      <AuthShell ambientCopy="A private home for the moments that matter.">
        <AuthFormPanel>
          <AuthHeading
            headline="Check your email."
            supportingLine="If an account exists for that email, we've sent a reset link."
            className="mb-8"
          />

          <p className="text-sm text-ink-muted">
            Follow the link in the email to choose a new password.
          </p>

          <p className="mt-8 text-center text-sm text-ink-muted">
            <GhostLink to="/signin">Back to sign in.</GhostLink>
          </p>
        </AuthFormPanel>
      </AuthShell>
    );
  }

  return (
    <AuthShell ambientCopy="A private home for the moments that matter.">
      <AuthFormPanel>
        <AuthHeading
          headline="Reset your password."
          supportingLine="We'll email you a secure link."
          className="mb-8"
        />

        <form
          className="space-y-5"
          onSubmit={handleSubmit}
          noValidate
          aria-describedby={
            formError ? "forgot-password-form-error" : undefined
          }
        >
          <TextField
            id="email"
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            disabled={isSubmitting}
            error={emailError}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={handleEmailBlur}
          />

          {formError && (
            <p
              id="forgot-password-form-error"
              role="alert"
              className="text-sm text-error"
            >
              {formError}
            </p>
          )}

          <PrimaryButton type="submit" loading={isSubmitting}>
            {isSubmitting ? "Sending link…" : "Send reset link"}
          </PrimaryButton>
        </form>

        <p className="mt-8 text-center text-sm text-ink-muted">
          <GhostLink to="/signin">Back to sign in.</GhostLink>
        </p>
      </AuthFormPanel>
    </AuthShell>
  );
}
