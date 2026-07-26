import { useEffect, useRef, useState, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { AuthContext } from "./AuthContext";
import type { AuthContextValue } from "./AuthContext";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAvatar = useCallback(async (userId: string) => {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", userId)
        .single();
      setAvatarUrl(profile?.avatar_url ?? null);
    } catch {
      setAvatarUrl(null);
    }
  }, []);

  const refreshAvatar = useCallback(async () => {
    if (user) {
      await fetchAvatar(user.id);
    }
  }, [user, fetchAvatar]);

  // Tracks the user id whose avatar we have already fetched. Held in a ref
  // (not a closure variable) so it survives React.StrictMode's dev-only
  // mount→unmount→remount cycle, which would otherwise reset a closure
  // variable to null and cause a redundant `profiles?select=avatar_url`
  // fetch on the second INITIAL_SESSION.
  const fetchedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // onAuthStateChange emits an INITIAL_SESSION event immediately upon
    // subscribing, so a separate getSession() call is not required to
    // hydrate the initial authentication state.
    //
    // IMPORTANT: onAuthStateChange also fires on TOKEN_REFRESHED — which
    // Supabase's autoRefreshToken triggers whenever the browser tab regains
    // focus/visibility and the JWT is near expiry. Re-fetching the avatar on
    // every such event causes a redundant `profiles?select=avatar_url` query
    // on every tab focus. We therefore only refetch the avatar when the
    // user IDENTITY actually changes (login, logout, account switch), and we
    // explicitly short-circuit TOKEN_REFRESHED as a belt-and-suspenders guard.
    // Avatar updates after an upload/delete are handled by the explicit
    // refreshAvatar() call, not by this listener.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      const newUser = session?.user ?? null;
      const newUserId = newUser?.id ?? null;
      setUser(newUser);

      // TOKEN_REFRESHED fires on every tab focus/visibility regain when the
      // JWT is near expiry. The user identity is unchanged, so never fetch.
      if (event === "TOKEN_REFRESHED") {
        setIsLoading(false);
        return;
      }

      // Only hit the profiles table when the signed-in user actually
      // changes — not on every token refresh or repeated INITIAL_SESSION
      // (e.g. StrictMode dev double-mount). The ref persists across
      // re-subscribes, so a repeated event for the same user is a no-op.
      if (newUserId !== fetchedUserIdRef.current) {
        fetchedUserIdRef.current = newUserId;
        if (newUserId) {
          await fetchAvatar(newUserId);
        } else {
          setAvatarUrl(null);
        }
      }

      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchAvatar]);

  const value: AuthContextValue = { user, avatarUrl, isLoading, refreshAvatar };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
