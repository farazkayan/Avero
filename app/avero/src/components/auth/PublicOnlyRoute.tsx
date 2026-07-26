import { Navigate, Outlet } from "react-router";
import { useAuth } from "../../context/AuthContext";
import { AUTHENTICATED_HOME_PATH } from "../../constants/routes";
import AuthLoadingScreen from "./AuthLoadingScreen";

/**
 * Layout-route guard for auth screens that an authenticated user should not
 * see (sign-in, sign-up, forgot-password).
 *
 * Redirect logic lives here — never duplicated inside pages — so each auth
 * page remains pure presentation.
 *
 * Resolution order:
 * 1. While the Supabase session is still resolving (`isLoading`), render the
 *    calm loading screen so the wrong page never flashes (auth-design §7).
 * 2. Once resolved, if a user exists, redirect to the authenticated area.
 * 3. Otherwise render the matched child route via `<Outlet />`.
 *
 * `useAuth()` is the single source of truth for authentication; this guard
 * does not touch Supabase or auth logic directly.
 */
export default function PublicOnlyRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (user) {
    return <Navigate to={AUTHENTICATED_HOME_PATH} replace />;
  }

  return <Outlet />;
}
