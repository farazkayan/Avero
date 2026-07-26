import { useState } from "react";
import AuthShell from "../components/auth/AuthShell";
import AuthFormPanel from "../components/auth/AuthFormPanel";
import AuthHeading from "../components/auth/AuthHeading";
import TextField from "../components/ui/TextField";
import PasswordField from "../components/ui/PasswordField";
import PrimaryButton from "../components/ui/PrimaryButton";
import GhostLink from "../components/ui/GhostLink";
import { supabase } from "../lib/supabase";

/**
 * Sign In screen — email/password authentication (auth-design §3.1, §4, §7).
 *
 * The page initiates the sign-in request via Supabase; it does not manage auth
 * state itself. On success the existing AuthProvider's `onAuthStateChange`
 * listener updates authentication state automatically (auth-design §3.6).
 */
export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(
    undefined
  );
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  function validatePassword(value: string): string | undefined {
    if (value.length === 0) {
      return "Enter your password.";
    }
    return undefined;
  }

  function handleEmailBlur() {
    setEmailError(validateEmail(email));
  }

  function handlePasswordBlur() {
    setPasswordError(validatePassword(password));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Prevent duplicate submissions while a request is in flight.
    if (isSubmitting) {
      return;
    }

    const nextEmailError = validateEmail(email);
    const nextPasswordError = validatePassword(password);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);

    if (nextEmailError || nextPasswordError) {
      return;
    }

    setFormError(undefined);
    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setFormError(mapSignInError(error));
        return;
      }

      // Success: do nothing here. The AuthProvider's auth listener updates
      // authentication state automatically (auth-design §3.6). No manual
      // state change, no redirect.
    } catch {
      // Covers network failures and other unexpected thrown errors that did
      // not surface as a Supabase AuthError.
      setFormError("Something went wrong on our end. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell ambientCopy="A private home for the moments that matter.">
      <AuthFormPanel>
        <AuthHeading
          headline="Welcome back."
          supportingLine="Sign in to return to your Spaces."
          className="mb-8"
        />

        <form
          className="space-y-5"
          onSubmit={handleSubmit}
          noValidate
          aria-describedby={formError ? "signin-form-error" : undefined}
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

          <PasswordField
            id="password"
            name="password"
            label="Password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            disabled={isSubmitting}
            error={passwordError}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={handlePasswordBlur}
          />

          <div className="flex justify-end">
            <GhostLink to="/forgot-password">Forgot password?</GhostLink>
          </div>

          {formError && (
            <p
              id="signin-form-error"
              role="alert"
              className="text-sm text-error"
            >
              {formError}
            </p>
          )}

          <PrimaryButton type="submit" loading={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </PrimaryButton>
        </form>

        <p className="mt-8 text-center text-sm text-ink-muted">
          Don't have an account?{" "}
          <GhostLink to="/signup">Create one.</GhostLink>
        </p>
      </AuthFormPanel>
    </AuthShell>
  );
}

/**
 * Maps a Supabase auth error to a calm, human-friendly message
 * (auth-design §7). Raw Supabase error messages are never shown to users.
 *
 * The `error` returned by `signInWithPassword` is typed by the SDK as
 * `AuthError | null`, which exposes a `code` property for specific cases.
 */
function mapSignInError(error: {
  code?: string;
  status?: number;
}): string {
  switch (error.code) {
    case "invalid_credentials":
      // Does not reveal which field is wrong (auth-design §7, security).
      return "That email or password doesn't match.";
    case "email_not_confirmed":
      // Email confirmation is enabled — the account exists but the email has
      // not been verified. Guide the user to their inbox without exposing
      // technical details.
      return "Please verify your email before signing in. Check your inbox for a confirmation link.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many attempts. Please wait a moment and try again.";
    case "user_banned":
      return "This account is not available. Please contact support if you believe this is a mistake.";
    case "request_timeout":
      return "The request took too long. Check your connection and try again.";
    default:
      // Network problems, unexpected failures, and any unmapped codes all
      // resolve to the same calm, honest message (auth-design §7).
      return "Something went wrong on our end. Please try again.";
  }
}
