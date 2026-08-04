import { Suspense, lazy } from "react";
import RouteLoadingFallback from "./ui/RouteLoadingFallback";

/**
 * Layout wrapper for authenticated pages that lazy-loads AppShell.
 *
 * This prevents AppShell (and its heavy dependencies: Supabase client,
 * react-router, avatar upload, etc.) from being included in the initial
 * bundle. AppShell is only loaded when the user navigates to an
 * authenticated route.
 */
const AppShell = lazy(() => import("./AppShell"));

type AuthenticatedLayoutProps = {
  children: React.ReactNode;
};

export default function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}