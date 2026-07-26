import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import AuthShell from "../components/auth/AuthShell";
import AuthFormPanel from "../components/auth/AuthFormPanel";
import AuthHeading from "../components/auth/AuthHeading";
import AuthLoadingScreen from "../components/auth/AuthLoadingScreen";
import TextField from "../components/ui/TextField";
import PrimaryButton from "../components/ui/PrimaryButton";
import GhostLink from "../components/ui/GhostLink";
import { supabase } from "../lib/supabase";
import { SIGN_IN_PATH, SIGN_UP_PATH, VERIFY_EMAIL_PATH } from "../constants/routes";

/**
 * How long the "Email verified!" success state is shown before the user is
 * automatically redirected to sign in (auth-design §3.5). Long enough to read
 * the confirmation, short enough not to feel like a stall.
 */
const REDIRECT_DELAY_MS = 2000;

/**
 * How long to wait for a SIGNED_IN event before concluding the verification
 * link is invalid or expired (auth-design §3.5, §7).
 *
 * The verification token exchange is a local background operation performed
 * by the Supabase client SDK — not a slow network request — so a few seconds
 * is plenty. If no SIGNED_IN event arrives within this window, the link is
 * treated as invalid or expired.
 */
const VERIFICATION_TIMEOUT_MS = 5000;

type VerifyStatus = "resolving" | "verified" | "failed";

/**
 * Verify Email screen — the landing page for email confirmation links
 * (auth-design §3.4, §3.5, §7).
 *
 * When a user clicks the confirmation link in their signup email, Supabase's
 * client SDK exchanges the token in the link for a session and emits a
 * SIGNED_IN event. This screen subscribes to `onAuthStateChange` and waits
 * for that event to determine whether verification succeeded:
 *
 * - SIGNED_IN event → verification succeeded → show "Email verified!" and
 *   redirect to sign in after a brief delay.
 * - No event within a short timeout → the link is invalid, expired, or
 *   absent → show a calm failure message with an option to resend the
 *   verification email.
 *
 * The temporary verification session is signed out before redirecting to sign
 * in, so the user is not left logged in via the verification token — they
 * sign in with their credentials to enter the app.
 */
export default function VerifyEmailPage() {
  const navigate = useNavigate();

  const [status, setStatus] = useState<VerifyStatus>("resolving");

  // Resend form state (shown only on the failure screen). The user's email is
  // not available in context — they arrived via an email link, not a form —
  // so it is collected here to call `supabase.auth.resend`.
  const [resendEmail, setResendEmail] = useState("");
  const [resendEmailError, setResendEmailError] = useState<
    string | undefined
  >(undefined);
  const [resendFormError, setResendFormError] = useState<
    string | undefined
  >(undefined);
  const [isResending, setIsResending] = useState(false);
  const [resendSentTo, setResendSentTo] = useState<string | null>(null);

  // Subscribe to Supabase auth state changes and wait for a SIGNED_IN event,
  // which fires when the client SDK exchanges the verification token from
  // the email link. Only this event signals success — a pre-existing session
  // is intentionally NOT treated as sufficient, so an already-logged-in user
  // visiting /verify-email directly does not see the success state
  // (auth-design §3.5, §7).
  //
  // A short timeout acts as the fallback: if no SIGNED_IN event arrives in
  // time, the link is treated as invalid or expired.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        setStatus("verified");
      }
    });

    const timeout = setTimeout(() => {
      setStatus((current) =>
        current === "resolving" ? "failed" : current
      );
    }, VERIFICATION_TIMEOUT_MS);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  // Once verification succeeds, sign out the temporary verification session
  // so the user is not left logged in via the verification token — they will
  // sign in with their credentials to enter the app. This runs in a separate
  // effect rather than inside the onAuthStateChange callback, because calling
  // auth methods from within that callback can trigger recursive events.
  useEffect(() => {
    if (status !== "verified") {
      return;
    }

    supabase.auth.signOut();
  }, [status]);

  // Once verified, redirect to sign in after a brief delay so the user can
  // read the confirmation. The timer is cleared on unmount so a click-through
  // navigation doesn't trigger a second redirect.
  useEffect(() => {
    if (status !== "verified") {
      return;
    }

    const timer = setTimeout(() => {
      navigate(SIGN_IN_PATH, { replace: true });
    }, REDIRECT_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [status, navigate]);

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

  function handleResendEmailBlur() {
    setResendEmailError(validateEmail(resendEmail));
  }

  async function handleResendSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Prevent duplicate submissions while a request is in flight.
    if (isResending) {
      return;
    }

    const nextEmailError = validateEmail(resendEmail);
    setResendEmailError(nextEmailError);

    if (nextEmailError) {
      return;
    }

    setResendFormError(undefined);
    setIsResending(true);

    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: resendEmail.trim(),
        options: {
          // The new link should return the user to this screen to verify.
          emailRedirectTo: `${window.location.origin}${VERIFY_EMAIL_PATH}`,
        },
      });

      if (error) {
        // Rate-limit errors are safe to surface — they reveal nothing about
        // whether an account exists.
        if (
          error.code === "over_request_rate_limit" ||
          error.code === "over_email_send_rate_limit"
        ) {
          setResendFormError(
            "Too many attempts. Please wait a moment and try again."
          );
          return;
        }
        // Any other error (including "user not found" if the project returns
        // it) is treated as success to avoid account enumeration, consistent
        // with the recovery flow (auth-design §3.3; ai-context §10).
      }

      // Show the same calm confirmation regardless of whether a pending
      // signup exists for this email (auth-design §3.3; ai-context §10).
      setResendSentTo(resendEmail.trim());
    } catch {
      // Network failures — safe to surface, they don't reveal account
      // existence (auth-design §7).
      setResendFormError("Something went wrong on our end. Please try again.");
    } finally {
      setIsResending(false);
    }
  }

  // While the verification session is being resolved, show the calm loading
  // screen so the user never sees an ambiguous blank state (auth-design §7).
  if (status === "resolving") {
    return <AuthLoadingScreen />;
  }

  // Verification succeeded — show a clear confirmation and redirect to sign
  // in automatically. The verification session has already been signed out.
  if (status === "verified") {
    return (
      <AuthShell ambientCopy="A private home for the moments that matter.">
        <AuthFormPanel>
          <AuthHeading
            headline="Email verified!"
            supportingLine="Your email is confirmed. Sign in to continue."
            className="mb-8"
          />

          <p className="text-sm text-ink-muted">
            Taking you to sign in…
          </p>

          <p className="mt-8 text-center text-sm text-ink-muted">
            <GhostLink to={SIGN_IN_PATH}>Continue to sign in.</GhostLink>
          </p>
        </AuthFormPanel>
      </AuthShell>
    );
  }

  // Verification failed — the link is invalid or expired. Show a calm message
  // with an option to resend the verification email. The user's email is not
  // available in context (they arrived via an email link), so it is collected
  // here to call `supabase.auth.resend` (auth-design §3.5, §7).
  return (
    <AuthShell ambientCopy="A private home for the moments that matter.">
      <AuthFormPanel>
        <AuthHeading
          headline="This link is invalid or has expired."
          supportingLine="Verification links can only be used once and expire after a short time."
          className="mb-8"
        />

        {resendSentTo ? (
          // Resend confirmation — replaces the resend form after a successful
          // request (auth-design §3.3). Same calm confirmation regardless of
          // whether a pending signup exists, to avoid account enumeration.
          <>
            <p className="text-sm text-ink-muted">
              If an account is waiting for verification, we've sent a new link
              to {resendSentTo}. Tap it to continue.
            </p>

            <p className="mt-8 text-center text-sm text-ink-muted">
              <GhostLink to={SIGN_IN_PATH}>Back to sign in.</GhostLink>
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Enter your email and we'll send a new verification link.
            </p>

            <form
              className="mt-6 space-y-5"
              onSubmit={handleResendSubmit}
              noValidate
              aria-describedby={
                resendFormError ? "verify-resend-form-error" : undefined
              }
            >
              <TextField
                id="resend-email"
                name="email"
                type="email"
                label="Email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={resendEmail}
                disabled={isResending}
                error={resendEmailError}
                onChange={(event) => setResendEmail(event.target.value)}
                onBlur={handleResendEmailBlur}
              />

              {resendFormError && (
                <p
                  id="verify-resend-form-error"
                  role="alert"
                  className="text-sm text-error"
                >
                  {resendFormError}
                </p>
              )}

              <PrimaryButton type="submit" loading={isResending}>
                {isResending ? "Sending link…" : "Resend verification"}
              </PrimaryButton>
            </form>

            <p className="mt-8 text-center text-sm text-ink-muted">
              Need to create an account?{" "}
              <GhostLink to={SIGN_UP_PATH}>Sign up.</GhostLink>
            </p>

            <p className="mt-2 text-center text-sm text-ink-muted">
              <GhostLink to={SIGN_IN_PATH}>Back to sign in.</GhostLink>
            </p>
          </>
        )}
      </AuthFormPanel>
    </AuthShell>
  );
}
