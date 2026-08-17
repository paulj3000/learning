import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Home } from '../routes/Home';
import { NotFound } from '../routes/NotFound';
import { SignUp } from '../routes/SignUp';
import { SignIn } from '../routes/SignIn';
import { ConfirmSignUp } from '../routes/ConfirmSignUp';
import { ForgotPassword } from '../routes/ForgotPassword';
import { ParentDashboard } from '../routes/ParentDashboard';
import { ChildProfileNew } from '../routes/ChildProfileNew';
import { ChildProfileEdit } from '../routes/ChildProfileEdit';
import { StoryKeepsakes } from '../routes/StoryKeepsakes';
import { ChildDashboard } from '../routes/ChildDashboard';
import { WelcomeHarbor } from '../routes/WelcomeHarbor';
import { IslandLocationPage } from '../routes/IslandLocationPage';
import { AdventurePage } from '../routes/AdventurePage';
import { AdventureLog } from '../routes/AdventureLog';
import { StoryPage } from '../routes/StoryPage';
import { RequireParent } from '../features/auth/RequireParent';
import { RequireGuest } from '../features/auth/RequireGuest';

/**
 * Lazy-loaded: this route (transitively) imports `phaser`, a large library
 * with a canvas-feature-detection side effect that runs at import time and
 * is incompatible with jsdom (docs/DECISIONS.md ADR-007's testing note).
 * Code-splitting it here keeps that import out of every other route's
 * bundle and out of the test import graph until a child actually opens the
 * explorable world.
 */
const IslandWorldPage = lazy(() =>
  import('../routes/IslandWorldPage').then((module) => ({ default: module.IslandWorldPage })),
);
const PirateBuilderBayWorldPage = lazy(() =>
  import('../routes/PirateBuilderBayWorldPage').then((module) => ({
    default: module.PirateBuilderBayWorldPage,
  })),
);
const WonderwildForestWorldPage = lazy(() =>
  import('../routes/WonderwildForestWorldPage').then((module) => ({
    default: module.WonderwildForestWorldPage,
  })),
);

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/sign-up"
        element={
          <RequireGuest>
            <SignUp />
          </RequireGuest>
        }
      />
      <Route
        path="/sign-in"
        element={
          <RequireGuest>
            <SignIn />
          </RequireGuest>
        }
      />
      <Route path="/confirm" element={<ConfirmSignUp />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route
        path="/parent"
        element={
          <RequireParent>
            <ParentDashboard />
          </RequireParent>
        }
      />
      <Route
        path="/parent/children/new"
        element={
          <RequireParent>
            <ChildProfileNew />
          </RequireParent>
        }
      />
      <Route
        path="/parent/children/:childId/edit"
        element={
          <RequireParent>
            <ChildProfileEdit />
          </RequireParent>
        }
      />
      <Route
        path="/parent/children/:childId/stories"
        element={
          <RequireParent>
            <StoryKeepsakes />
          </RequireParent>
        }
      />
      <Route
        path="/parent/children/:childId/dashboard"
        element={
          <RequireParent>
            <ChildDashboard />
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId"
        element={
          <RequireParent>
            <WelcomeHarbor />
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/world"
        element={
          <RequireParent>
            <Suspense fallback={<p>Loading the island...</p>}>
              <IslandWorldPage />
            </Suspense>
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/world/pirate-builder-bay"
        element={
          <RequireParent>
            <Suspense fallback={<p>Loading Pirate Builder Bay...</p>}>
              <PirateBuilderBayWorldPage />
            </Suspense>
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/world/wonderwild-forest"
        element={
          <RequireParent>
            <Suspense fallback={<p>Loading Wonderwild Forest...</p>}>
              <WonderwildForestWorldPage />
            </Suspense>
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/locations/:locationSlug"
        element={
          <RequireParent>
            <IslandLocationPage />
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/locations/:locationSlug/adventures/:templateSlug"
        element={
          <RequireParent>
            <AdventurePage />
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/log"
        element={
          <RequireParent>
            <AdventureLog />
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/stories/:storySlug"
        element={
          <RequireParent>
            <StoryPage />
          </RequireParent>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
