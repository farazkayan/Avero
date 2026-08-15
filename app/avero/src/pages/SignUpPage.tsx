import { useState } from "react";
import AuthShell from "../components/auth/AuthShell";
import AuthFormPanel from "../components/auth/AuthFormPanel";
import AuthHeading from "../components/auth/AuthHeading";
import TextField from "../components/ui/TextField";
import PasswordField from "../components/ui/PasswordField";
import PrimaryButton from "../components/ui/PrimaryButton";
import GhostLink from "../components/ui/GhostLink";
import Spinner from "../components/ui/Spinner";
import { GoogleIcon } from "../components/ui/icons";
import { supabase } from "../lib/supabase";
import { VERIFY_EMAIL_PATH } from "../constants/routes";

/**
 * Minimum password length enforced by Avero (auth-design §7).
 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Sign Up screen — name/email/password registration (auth-design §3.2, §4, §7).
 *
 * The page initiates the sign-up request via Supabase and stores the user's
 * name in Auth metadata. It does not create profile/database records yet, and
 * it does not sign the user in — when email confirmation is enabled,
 * `signUp()` returns a user without a session. On success the form is replaced
 * by the Email Verification notice (auth-design §3.4).
 */
export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(
    undefined
  );
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // When set, the form is replaced by the Email Verification notice
  // (auth-design §3.4). Holds the email the verification link was sent to.
  const [verificationEmail, setVerificationEmail] = useState<string | null>(
    null
  );

  async function handleGoogleSignIn() {
    if (isGoogleLoading) return;
    setIsGoogleLoading(true);
    setFormError(undefined);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setFormError(mapSignUpError(error));
      }
      // On success, the browser redirects to Google's consent screen.
      // After consent, Supabase redirects back to the app via the callback route.
    } catch {
      setFormError("Something went wrong on our end. Please try again.");
    } finally {
      setIsGoogleLoading(false);
    }
  }

  function validateName(value: string): string | undefined {
    if (value.trim().length === 0) {
      return "Enter your name.";
    }
    return undefined;
  }

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
      return "Enter a password.";
    }
    if (value.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    return undefined;
  }

  function handleNameBlur() {
    setNameError(validateName(name));
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

    const nextNameError = validateName(name);
    const nextEmailError = validateEmail(email);
    const nextPasswordError = validatePassword(password);
    setNameError(nextNameError);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);

    if (nextNameError || nextEmailError || nextPasswordError) {
      return;
    }

    setFormError(undefined);
    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // Store the user's name in Auth metadata. No profile/database
          // records are created yet (auth-design §3.2).
          data: { name: name.trim() },
          // Route the confirmation link through the Verify Email screen
          // (auth-design §3.4, §3.5) rather than Supabase's default Site URL.
          // Without this, the user skips VerifyEmailPage entirely and lands at
          // the app root with a raw access_token in the URL. Mirrors the
          // emailRedirectTo used by the resend flow in VerifyEmailPage.tsx.
          emailRedirectTo: `${window.location.origin}${VERIFY_EMAIL_PATH}`,
        },
      });

      if (error) {
        setFormError(mapSignUpError(error));
        return;
      }

      // Success: email confirmation is enabled, so the user is not signed in.
      // Replace the form with the Email Verification notice (auth-design §3.4).
      setVerificationEmail(email.trim());
    } catch {
      // Covers network failures and other unexpected thrown errors that did
      // not surface as a Supabase AuthError.
      setFormError("Something went wrong on our end. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleUseDifferentEmail() {
    setVerificationEmail(null);
    setFormError(undefined);
  }

  // Email Verification notice — replaces the form after a successful sign-up
  // (auth-design §3.4). No form, one clear next step in the user's inbox.
  if (verificationEmail) {
    return (
      <AuthShell ambientCopy="A private home for the moments that matter.">
        <AuthFormPanel>
          <AuthHeading
            headline="Check your email."
            supportingLine={`We sent a verification link to ${verificationEmail}. Tap it to continue.`}
            className="mb-8"
          />

          <p className="text-sm text-ink-muted">
            Once you've verified your email, you can sign in to your account.
          </p>

          <div className="mt-8">
            <button
              type="button"
              onClick={handleUseDifferentEmail}
              className={[
                "inline-flex items-center justify-center text-sm font-medium",
                "text-ink-muted transition-colors duration-200",
                "hover:text-accent-400 focus:outline-none focus-visible:text-accent-400",
                "focus-visible:ring-2 focus-visible:ring-accent-500/60 rounded-md",
              ].join(" ")}
            >
              Use a different email
            </button>
          </div>
        </AuthFormPanel>
      </AuthShell>
    );
  }

  return (
    <AuthShell ambientCopy="A private home for the moments that matter.">
      <AuthFormPanel>
        <AuthHeading
          headline="Begin preserving what matters."
          supportingLine="Create your account to start preserving shared memories."
          className="mb-8"
        />

        {/* Google OAuth button */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isGoogleLoading || isSubmitting}
          className={[
            "inline-flex w-full items-center justify-center gap-2 rounded-lg",
            "px-4 py-2.5 text-base font-medium text-ink",
            "bg-canvas-raised border border-ink/10 transition-colors duration-200",
            "hover:bg-ink/5 active:bg-ink/10",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            (isGoogleLoading || isSubmitting)
              ? "cursor-not-allowed opacity-60"
              : "",
          ].join(" ")}
        >
          {isGoogleLoading && <Spinner size={18} />}
          <GoogleIcon className="flex-shrink-0" />
          <span>Continue with Google</span>
        </button>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-ink/10" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-canvas-soft text-ink-muted">Or continue with email</span>
          </div>
        </div>

        <form
          className="space-y-5"
          onSubmit={handleSubmit}
          noValidate
          aria-describedby={formError ? "signup-form-error" : undefined}
        >
          <TextField
            id="name"
            name="name"
            type="text"
            label="Name"
            autoComplete="name"
            placeholder="Your name"
            value={name}
            disabled={isSubmitting}
            error={nameError}
            onChange={(event) => setName(event.target.value)}
            onBlur={handleNameBlur}
          />

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
            autoComplete="new-password"
            placeholder="Create a password"
            helperText={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            value={password}
            disabled={isSubmitting}
            error={passwordError}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={handlePasswordBlur}
          />

          {formError && (
            <p
              id="signup-form-error"
              role="alert"
              className="text-sm text-error"
            >
              {formError}
            </p>
          )}

          <PrimaryButton type="submit" loading={isSubmitting}>
            {isSubmitting ? "Creating account…" : "Create account"}
          </PrimaryButton>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          Your memories stay private. Only the people you invite can see them.
        </p>

        <p className="mt-8 text-center text-sm text-ink-muted">
          Already have an account?{" "}
          <GhostLink to="/signin">Sign in.</GhostLink>
        </p>
      </AuthFormPanel>
    </AuthShell>
  );
}

/**
 * Maps a Supabase auth error to a calm, human-friendly message
 * (auth-design §7). Raw Supabase error messages are never shown to users.
 *
 * The `error` returned by `signUp` is typed by the SDK as `AuthError | null`,
 * which exposes a `code` property for specific cases.
 */
function mapSignUpError(error: {
  code?: string;
  status?: number;
}): string {
  switch (error.code) {
    case "user_already_exists":
      // An account with this email already exists (auth-design §7).
      return "An account with this email already exists. Sign in instead?";
    case "weak_password":
      // Supabase rejected the password for being too weak.
      return `Choose a stronger password. Use at least ${MIN_PASSWORD_LENGTH} characters.`;
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
