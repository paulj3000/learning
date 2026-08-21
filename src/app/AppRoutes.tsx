import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Home } from '../routes/Home';
import { NotFound } from '../routes/NotFound';
import { SignUp } from '../routes/SignUp';
import { SignIn } from '../routes/SignIn';
import { ConfirmSignUp } from '../routes/ConfirmSignUp';
import { ForgotPassword } from '../routes/ForgotPassword';
import { ParentDashboard } from '../routes/ParentDashboard';
import { AccountSettings } from '../routes/AccountSettings';
import { ChildProfileNew } from '../routes/ChildProfileNew';
import { ChildProfileEdit } from '../routes/ChildProfileEdit';
import { StoryKeepsakes } from '../routes/StoryKeepsakes';
import { ChildDashboard } from '../routes/ChildDashboard';
import { CoopSessionNew } from '../routes/CoopSessionNew';
import { WelcomeHarbor } from '../routes/WelcomeHarbor';
import { IslandLocationPage } from '../routes/IslandLocationPage';
import { AdventurePage } from '../routes/AdventurePage';
import { AdventureLog } from '../routes/AdventureLog';
import { QuestJournal } from '../routes/QuestJournal';
import { StoryPage } from '../routes/StoryPage';
import { AdventureLibraryPage } from '../routes/AdventureLibraryPage';
import { AdminDashboard } from '../routes/AdminDashboard';
import { AdminChildProgress } from '../routes/AdminChildProgress';
import { RequireParent } from '../features/auth/RequireParent';
import { RequireGuest } from '../features/auth/RequireGuest';
import { RequireAdmin } from '../features/auth/RequireAdmin';

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
const StorykeeperCastleWorldPage = lazy(() =>
  import('../routes/StorykeeperCastleWorldPage').then((module) => ({
    default: module.StorykeeperCastleWorldPage,
  })),
);
const DragonsSanctuaryWorldPage = lazy(() =>
  import('../routes/DragonsSanctuaryWorldPage').then((module) => ({
    default: module.DragonsSanctuaryWorldPage,
  })),
);
const FossilRidgeCampWorldPage = lazy(() =>
  import('../routes/FossilRidgeCampWorldPage').then((module) => ({
    default: module.FossilRidgeCampWorldPage,
  })),
);
const CastleWritingRoomWorldPage = lazy(() =>
  import('../routes/CastleWritingRoomWorldPage').then((module) => ({
    default: module.CastleWritingRoomWorldPage,
  })),
);
const BoltsWorkshopWorldPage = lazy(() =>
  import('../routes/BoltsWorkshopWorldPage').then((module) => ({
    default: module.BoltsWorkshopWorldPage,
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
        path="/home"
        element={
          <RequireParent>
            <ParentDashboard />
          </RequireParent>
        }
      />
      <Route
        path="/home/settings"
        element={
          <RequireParent>
            <AccountSettings />
          </RequireParent>
        }
      />
      <Route
        path="/home/children/new"
        element={
          <RequireParent>
            <ChildProfileNew />
          </RequireParent>
        }
      />
      <Route
        path="/home/children/:childId/edit"
        element={
          <RequireParent>
            <ChildProfileEdit />
          </RequireParent>
        }
      />
      <Route
        path="/home/children/:childId/stories"
        element={
          <RequireParent>
            <StoryKeepsakes />
          </RequireParent>
        }
      />
      <Route
        path="/home/children/:childId/dashboard"
        element={
          <RequireParent>
            <ChildDashboard />
          </RequireParent>
        }
      />
      <Route
        path="/home/coop/new"
        element={
          <RequireParent>
            <CoopSessionNew />
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
        path="/island/:childId/world/storykeeper-castle"
        element={
          <RequireParent>
            <Suspense fallback={<p>Loading Storykeeper Castle...</p>}>
              <StorykeeperCastleWorldPage />
            </Suspense>
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/world/dragons-sanctuary"
        element={
          <RequireParent>
            <Suspense fallback={<p>Loading the Dragon's Sanctuary...</p>}>
              <DragonsSanctuaryWorldPage />
            </Suspense>
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/world/fossil-ridge-camp"
        element={
          <RequireParent>
            <Suspense fallback={<p>Loading Fossil Ridge Camp...</p>}>
              <FossilRidgeCampWorldPage />
            </Suspense>
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/world/castle-writing-room"
        element={
          <RequireParent>
            <Suspense fallback={<p>Loading the Writing Room...</p>}>
              <CastleWritingRoomWorldPage />
            </Suspense>
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/world/bolts-workshop"
        element={
          <RequireParent>
            <Suspense fallback={<p>Loading Bolt's Workshop...</p>}>
              <BoltsWorkshopWorldPage />
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
        path="/island/:childId/quests"
        element={
          <RequireParent>
            <QuestJournal />
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/library"
        element={
          <RequireParent>
            <AdventureLibraryPage />
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
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminDashboard />
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/children/:childId"
        element={
          <RequireAdmin>
            <AdminChildProgress />
          </RequireAdmin>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
