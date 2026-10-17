import { lazy } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AuthProvider, RequireAuth } from "./hooks/useAuth";
import { useFavorites } from "./hooks/useFavorites";
import { LEGAL_ROUTES } from "./lib/legal";

// Every screen is lazy so the first paint only ships the shell, the auth gate
// and the route the user actually landed on. On the low-end Android webviews
// this app targets, that gap is the difference between a fast open and a blank
// screen. `Login` stays eager: it is the first thing a signed-out client shows.
import Login from "./pages/Login";

const MatchDetail = lazy(() => import("./pages/MatchDetail"));
const Cups = lazy(() => import("./pages/Cups"));
const Matches = lazy(() => import("./pages/Matches"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Profile = lazy(() => import("./pages/Profile"));
const Admin = lazy(() => import("./pages/Admin"));
const Ratings = lazy(() => import("./pages/Ratings"));
const TeamPage = lazy(() => import("./pages/TeamPage"));
const Table = lazy(() => import("./pages/Table"));
const Privacy = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Terms })));

export default function App() {
  return (
    <AuthProvider>
      {/* The Suspense boundary for lazy pages lives inside AppShell, around the
          Outlet, so the tab bar stays put while a route chunk loads. */}
      <Routes>
        {/* The Login screen sits outside the guarded shell (no tab bar). */}
        <Route path="/login" element={<Login />} />

        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            {/* First run: the concept's onboarding (favorite → clubs → leagues). */}
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/" element={<OnboardingGate />} />
            <Route path="/matches" element={<Matches />} />
            <Route path="/cups" element={<Cups />} />
            <Route path="/match/:id" element={<MatchDetail />} />
            <Route path="/team/:id" element={<TeamPage />} />
            {/* My Teams is gone — the onboarding picker is the only place to
                manage favorites. Old deep links land there. The fantasy Draft
                route folds in the same way. */}
            <Route path="/my-teams" element={<Navigate to="/onboarding" replace />} />
            <Route path="/draft" element={<Navigate to="/onboarding" replace />} />
            {/* Legacy deep link: the Shot Plotter used to be its own route, then
                moved into the Predict tab, and predictions are off for now. The
                old redirect target (?tab=predict) no longer exists in
                MatchDetail, so it silently landed on Timeline — legacy links
                now open the match summary itself. */}
            <Route path="/match/:id/shot-plotter" element={<ShotPlotterRedirect />} />
            <Route path="/ratings" element={<Ratings />} />
            <Route path="/table" element={<Table />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/admin" element={<Admin />} />
            {/* Legal pages: reachable from Profile and the onboarding footer. */}
            <Route path={LEGAL_ROUTES.privacy} element={<Privacy />} />
            <Route path={LEGAL_ROUTES.terms} element={<Terms />} />
            {/* Unknown path: say so instead of silently redirecting (broken
                  deep links from the bot become visible). */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}

/**
 * Legacy `/match/:id/shot-plotter` → `/match/:id` (the match summary).
 * The Shot Plotter has no tab of its own while predictions are gated off, so
 * the old deep link opens the match on its default Timeline tab.
 *
 * `Navigate` does not interpolate route params (its `to` is a literal string,
 * so `"/match/:id"` would navigate to a URL containing the characters ":id"),
 * hence the wrapper that reads the param.
 */
function ShotPlotterRedirect() {
  const { id } = useParams();
  return <Navigate to={`/match/${id}`} replace />;
}

/**
 * First-run gate: users with no club picks land on onboarding once; everyone
 * else goes straight to the matchday feed. A localStorage flag marks the
 * onboarding as visited so skipping (no picks) doesn't loop back to it.
 */
function OnboardingGate() {
  const { teams, loading } = useFavorites();
  const seen = (() => {
    try {
      return localStorage.getItem("verdikick.onboarded") === "1";
    } catch {
      return false;
    }
  })();
  if (loading) return null;
  if (teams.length === 0 && !seen) return <Navigate to="/onboarding" replace />;
  return <Navigate to="/matches" replace />;
}
