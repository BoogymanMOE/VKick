import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AuthProvider, RequireAuth } from "./hooks/useAuth";
import { useFavorites } from "./hooks/useFavorites";

// Every screen is lazy so the first paint only ships the shell, the auth gate
// and the route the user actually landed on. On the low-end Android webviews
// this app targets, that gap is the difference between a fast open and a blank
// screen. `Login` stays eager: it is the first thing a signed-out client shows.
import Login from "./pages/Login";

const Browse = lazy(() => import("./pages/Browse"));
const MatchDetail = lazy(() => import("./pages/MatchDetail"));
const MatchReplayPage = lazy(() => import("./pages/MatchReplayPage"));
const Cups = lazy(() => import("./pages/Cups"));
const MyTeams = lazy(() => import("./pages/MyTeams"));
const Matches = lazy(() => import("./pages/Matches"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const PlayerStats = lazy(() => import("./pages/PlayerStats"));
const Profile = lazy(() => import("./pages/Profile"));
const Ratings = lazy(() => import("./pages/Ratings"));
const TeamPage = lazy(() => import("./pages/TeamPage"));
const Table = lazy(() => import("./pages/Table"));
const Leaderboards = lazy(() => import("./pages/Leaderboards"));
const Predictions = lazy(() => import("./pages/Predictions"));

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
            <Route path="/browse" element={<Browse />} />
            <Route path="/matches" element={<Matches />} />
            <Route path="/cups" element={<Cups />} />
            <Route path="/match/:id" element={<MatchDetail />} />
            <Route path="/match/:id/replay" element={<MatchReplayPage />} />
            <Route path="/team/:id" element={<TeamPage />} />
            <Route path="/my-teams" element={<MyTeams />} />
            {/* The fantasy Draft screen became My Teams; keep old links working.
                  The old shot-plotter route folds into the match Predict tab. */}
            <Route path="/draft" element={<Navigate to="/my-teams" replace />} />
            <Route path="/match/:id/shot-plotter" element={<MatchDetail />} />
            <Route path="/ratings" element={<Ratings />} />
            <Route path="/table" element={<Table />} />
            <Route path="/leaderboards" element={<Leaderboards />} />
            <Route path="/predictions" element={<Predictions />} />
            <Route path="/stats" element={<PlayerStats />} />
            <Route path="/profile" element={<Profile />} />
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
