import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import AuthShell from "../components/auth/AuthShell";
import AuthFormPanel from "../components/auth/AuthFormPanel";
import AuthHeading from "../components/auth/AuthHeading";
import AuthLoadingScreen from "../components/auth/AuthLoadingScreen";
import GhostLink from "../components/ui/GhostLink";
import { supabase } from "../lib/supabase";
import { uploadAvatar } from "../lib/avatar";
import { SIGN_IN_PATH, AUTHENTICATED_HOME_PATH } from "../constants/routes";

/**
 * OAuth callback screen — handles the redirect from Supabase after Google OAuth.
 *
 * When a user clicks "Continue with Google" on sign-in or sign-up, they are
 * redirected to Google's consent screen. After consent, Supabase redirects back
 * to this route with a code in the URL. The Supabase client SDK automatically
 * exchanges that code for a session and emits a SIGNED_IN event.
 *
 * This screen:
 * 1. Waits for the SIGNED_IN event (or a short timeout)
 * 2. On first-time Google sign-in, populates the profile with Google's
 *    full_name and avatar_url (downloaded and uploaded to B2 via avatar pipeline)
 * 3. Redirects to the authenticated home (spaces dashboard)
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();

  const [status, setStatus] = useState<"resolving" | "completed" | "failed">("resolving");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  // Subscribe to Supabase auth state changes and wait for a SIGNED_IN event,
  // which fires when the client SDK exchanges the OAuth code for a session.
  useEffect(() => {
    let mounted = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (event === "SIGNED_IN" && session?.user) {
        const user = session.user;

        // Check if this is a first-time Google sign-in by looking at user_metadata
        // and whether the profile already has a display_name/avatar_url
        const isGoogleProvider = user.app_metadata?.provider === "google";
        const googleFullName = user.user_metadata?.full_name;
        const googleAvatarUrl = user.user_metadata?.avatar_url;

        if (isGoogleProvider && (googleFullName || googleAvatarUrl)) {
          try {
            // Fetch current profile to see if it needs population
            const { data: profile } = await supabase
              .from("profiles")
              .select("display_name, avatar_url")
              .eq("id", user.id)
              .single();

            const needsName = !profile?.display_name && googleFullName;
            const needsAvatar = !profile?.avatar_url && googleAvatarUrl;

            if (needsName || needsAvatar) {
              // Update profile with Google's full_name
              if (needsName) {
                const { error: nameError } = await supabase
                  .from("profiles")
                  .update({ display_name: googleFullName })
                  .eq("id", user.id);

                if (nameError) {
                  console.error("[auth-callback] Failed to update display_name:", nameError);
                }
              }

              // Download Google avatar and upload via avatar pipeline to B2
              if (needsAvatar && googleAvatarUrl) {
                try {
                  const avatarResponse = await fetch(googleAvatarUrl);
                  if (avatarResponse.ok) {
                    const avatarBlob = await avatarResponse.blob();
                    // Create a File from the blob for uploadAvatar
                    const avatarFile = new File([avatarBlob], "avatar.webp", { type: "image/webp" });
                    const uploadResult = await uploadAvatar(avatarFile);
                    if (!uploadResult.ok) {
                      console.error("[auth-callback] Avatar upload failed:", uploadResult.error);
                    }
                  }
                } catch (avatarErr) {
                  console.error("[auth-callback] Failed to download/upload Google avatar:", avatarErr);
                }
              }
            }
          } catch (profileErr) {
            console.error("[auth-callback] Profile population error:", profileErr);
          }
        }

        setStatus("completed");
      }
    });

    // Fallback timeout in case the SIGNED_IN event doesn't fire
    const timeout = setTimeout(() => {
      if (mounted && status === "resolving") {
        setStatus("failed");
        setErrorMessage("Authentication timed out. Please try again.");
      }
    }, 10000);

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [status]);

  // Once completed, redirect to the authenticated home
  useEffect(() => {
    if (status === "completed") {
      navigate(AUTHENTICATED_HOME_PATH, { replace: true });
    }
  }, [status, navigate]);

  // While resolving, show the calm loading screen
  if (status === "resolving") {
    return <AuthLoadingScreen />;
  }

  // Failed — show error with option to go back to sign in
  if (status === "failed") {
    return (
      <AuthShell ambientCopy="A private home for the moments that matter.">
        <AuthFormPanel>
          <AuthHeading
            headline="Sign in with Google failed"
            supportingLine={errorMessage ?? "Something went wrong. Please try again."}
            className="mb-8"
          />

          <p className="mt-8 text-center text-sm text-ink-muted">
            <GhostLink to={SIGN_IN_PATH}>Back to sign in.</GhostLink>
          </p>
        </AuthFormPanel>
      </AuthShell>
    );
  }

  // Completed — brief success state before redirect (handled by effect above)
  return (
    <AuthShell ambientCopy="A private home for the moments that matter.">
      <AuthFormPanel>
        <AuthHeading
          headline="Welcome!"
          supportingLine="Signing you in…"
          className="mb-8"
        />
      </AuthFormPanel>
    </AuthShell>
  );
}