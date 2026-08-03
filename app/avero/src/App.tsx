import { Navigate, Route, Routes } from "react-router";
import { Suspense, lazy } from "react";
import SignInPage from "./pages/SignInPage";
import SignUpPage from "./pages/SignUpPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import AuthCallbackPage from "./pages/AuthCallbackPage";
import SpacesDashboardPage from "./pages/SpacesDashboardPage";
import CreateSpacePage from "./pages/CreateSpacePage";
import MemoryDetailPage from "./pages/MemoryDetailPage";
import EditMemoryPage from "./pages/EditMemoryPage";
import SpaceDetailPage from "./pages/SpaceDetailPage";
import SpaceSettingsPage from "./pages/SpaceSettingsPage";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import PublicOnlyRoute from "./components/auth/PublicOnlyRoute";
import RouteLoadingFallback from "./components/ui/RouteLoadingFallback";
import {
  AUTHENTICATED_HOME_PATH,
  SETTINGS_PATH,
  SIGN_IN_PATH,
  AUTH_CALLBACK_PATH,
} from "./constants/routes";

// Lazy-loaded routes (not needed on initial load)
const CreateMemoryPage = lazy(() => import("./pages/CreateMemoryPage"));
const SpaceStatsPage = lazy(() => import("./pages/SpaceStatsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

/**
 * Application routes.
 *
 * The router itself is configured in `main.tsx` via `<BrowserRouter>`, which
 * wraps the `AuthProvider` so authentication state is available to every
 * route. This component only declares the route table.
 *
 * Route categories (auth-design §3):
 * - Public-only (authenticated users redirected away): sign-in, sign-up,
 *   forgot-password. Wrapped in `PublicOnlyRoute`.
 * - Public (everyone, no redirect either way): verify-email, reset-password.
 * - Protected (unauthenticated redirected to sign-in): the authenticated
 *   area. Wrapped in `ProtectedRoute`.
 *
 * The index route redirects to the authenticated home; if the user is
 * unauthenticated, `ProtectedRoute` then redirects to sign-in. Unknown routes
 * redirect to sign-in directly — easy to replace with a proper 404 page later.
 */
export default function App() {
  return (
    <Routes>
      <Route index element={<Navigate to={AUTHENTICATED_HOME_PATH} replace />} />

      {/* Auth screens an authenticated user should not see */}
      <Route element={<PublicOnlyRoute />}>
        <Route path="signin" element={<SignInPage />} />
        <Route path="signup" element={<SignUpPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      {/* Public screens accessible to everyone */}
      <Route path="verify-email" element={<VerifyEmailPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />
      <Route path="invite/:token" element={<AcceptInvitePage />} />
      <Route path={AUTH_CALLBACK_PATH} element={<AuthCallbackPage />} />

      {/* Protected authenticated area */}
      <Route element={<ProtectedRoute />}>
        <Route path="spaces" element={<SpacesDashboardPage />} />
        <Route path="spaces/new" element={<CreateSpacePage />} />
        <Route path="spaces/:spaceId" element={<SpaceDetailPage />} />
        <Route
          path="spaces/:spaceId/settings"
          element={<SpaceSettingsPage />}
        />
        <Route
          path="spaces/:spaceId/stats"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <SpaceStatsPage />
            </Suspense>
          }
        />
        <Route
          path={SETTINGS_PATH}
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <SettingsPage />
            </Suspense>
          }
        />
        <Route
          path="spaces/:spaceId/memories/new"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <CreateMemoryPage />
            </Suspense>
          }
        />
        <Route
          path="spaces/:spaceId/memories/:memoryId"
          element={<MemoryDetailPage />}
        />
        <Route
          path="spaces/:spaceId/memories/:memoryId/edit"
          element={<EditMemoryPage />}
        />
      </Route>

      {/* Unknown routes — redirect to sign-in (swap for a 404 page later) */}
      <Route path="*" element={<Navigate to={SIGN_IN_PATH} replace />} />
    </Routes>
  );
}
