import { Navigate, Outlet } from "react-router";
import { useAuth } from "../../context/AuthContext";
import { SIGN_IN_PATH } from "../../constants/routes";
import AuthLoadingScreen from "./AuthLoadingScreen";

/**
 * Layout-route guard for protected application routes.
 *
 * It is the single gatekeeper for any route an unauthenticated user must not
 * reach. Redirect logic lives here — never duplicated inside pages — so each
 * page remains pure presentation.
 *
 * Resolution order:
 * 1. While the Supabase session is still resolving (`isLoading`), render the
 *    calm loading screen so the wrong page never flashes (auth-design §7).
 * 2. Once resolved, if there is no user, redirect to the sign-in page.
 * 3. Otherwise render the matched child route via `<Outlet />`.
 *
 * `useAuth()` is the single source of truth for authentication; this guard
 * does not touch Supabase or auth logic directly.
 */
export default function ProtectedRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (!user) {
    return <Navigate to={SIGN_IN_PATH} replace />;
  }

  return <Outlet />;
}
