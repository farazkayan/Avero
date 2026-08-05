import { Navigate, Route, Routes } from "react-router";
import { Suspense, lazy } from "react";
import SignInPage from "./pages/SignInPage";
import SignUpPage from "./pages/SignUpPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import AuthCallbackPage from "./pages/AuthCallbackPage";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import PublicOnlyRoute from "./components/auth/PublicOnlyRoute";
import RouteLoadingFallback from "./components/ui/RouteLoadingFallback";
import AuthenticatedLayout from "./components/AuthenticatedLayout";
import {
  AUTHENTICATED_HOME_PATH,
  SETTINGS_PATH,
  SIGN_IN_PATH,
  AUTH_CALLBACK_PATH,
} from "./constants/routes";

// Lazy-loaded routes (not needed on initial load)
const CreateMemoryPage = lazy(() => import("./pages/CreateMemoryPage"));
const SpaceStatsPage = lazy(() => import("./pages/SpaceStatsPage"));
const SpaceMapPage = lazy(() => import("./pages/SpaceMapPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

// Lazy-loaded authenticated pages (wrapped in AuthenticatedLayout which lazy-loads AppShell)
const SpacesDashboardPage = lazy(() => import("./pages/SpacesDashboardPage"));
const CreateSpacePage = lazy(() => import("./pages/CreateSpacePage"));
const MemoryDetailPage = lazy(() => import("./pages/MemoryDetailPage"));
const EditMemoryPage = lazy(() => import("./pages/EditMemoryPage"));
const SpaceDetailPage = lazy(() => import("./pages/SpaceDetailPage"));
const SpaceSettingsPage = lazy(() => import("./pages/SpaceSettingsPage"));

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
        <Route
          path="spaces"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <AuthenticatedLayout>
                <SpacesDashboardPage />
              </AuthenticatedLayout>
            </Suspense>
          }
        />
        <Route
          path="spaces/new"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <AuthenticatedLayout>
                <CreateSpacePage />
              </AuthenticatedLayout>
            </Suspense>
          }
        />
        <Route
          path="spaces/:spaceId"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <AuthenticatedLayout>
                <SpaceDetailPage />
              </AuthenticatedLayout>
            </Suspense>
          }
        />
        <Route
          path="spaces/:spaceId/settings"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <AuthenticatedLayout>
                <SpaceSettingsPage />
              </AuthenticatedLayout>
            </Suspense>
          }
        />
        <Route
          path="spaces/:spaceId/stats"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <AuthenticatedLayout>
                <SpaceStatsPage />
              </AuthenticatedLayout>
            </Suspense>
          }
        />
        <Route
          path="spaces/:spaceId/map"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <AuthenticatedLayout>
                <SpaceMapPage />
              </AuthenticatedLayout>
            </Suspense>
          }
        />
        <Route
          path={SETTINGS_PATH}
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <AuthenticatedLayout>
                <SettingsPage />
              </AuthenticatedLayout>
            </Suspense>
          }
        />
        <Route
          path="spaces/:spaceId/memories/new"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <AuthenticatedLayout>
                <CreateMemoryPage />
              </AuthenticatedLayout>
            </Suspense>
          }
        />
        <Route
          path="spaces/:spaceId/memories/:memoryId"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <AuthenticatedLayout>
                <MemoryDetailPage />
              </AuthenticatedLayout>
            </Suspense>
          }
        />
        <Route
          path="spaces/:spaceId/memories/:memoryId/edit"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <AuthenticatedLayout>
                <EditMemoryPage />
              </AuthenticatedLayout>
            </Suspense>
          }
        />
      </Route>

      {/* Unknown routes — redirect to sign-in (swap for a 404 page later) */}
      <Route path="*" element={<Navigate to={SIGN_IN_PATH} replace />} />
    </Routes>
  );
}
