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
import { LegacyLocationWorldRedirect } from '../routes/LegacyLocationWorldRedirect';
import { LOCATION_WORLD_ROUTE } from '../features/island-map/three/runtime/locationWorldPath';
import {
  PIRATE_BUILDER_BAY_REGION_ID,
  WELCOME_HARBOR_REGION_ID,
} from '../features/discovery/checkpoints';
import { IslandLocationPage } from '../routes/IslandLocationPage';
import { AdventurePage } from '../routes/AdventurePage';
import { AdventureLog } from '../routes/AdventureLog';
import { QuestJournal } from '../routes/QuestJournal';
import { TravelDeck } from '../routes/TravelDeck';
import { WorldHubPage } from '../routes/WorldHubPage';
import { StoryPage } from '../routes/StoryPage';
import { AdventureLibraryPage } from '../routes/AdventureLibraryPage';
import { AdminDashboard } from '../routes/AdminDashboard';
import { AdminChildProgress } from '../routes/AdminChildProgress';
import { AdminAssets } from '../routes/AdminAssets';
import { AdminModelAssets } from '../routes/AdminModelAssets';
import { AdminNewModelAsset } from '../routes/AdminNewModelAsset';
import { AdminIslands } from '../routes/AdminIslands';
import { AdminIslandForm } from '../routes/AdminIslandForm';
import { AdminIslandDetail } from '../routes/AdminIslandDetail';
import { AdminAdventures } from '../routes/AdminAdventures';
import { AdminAdventureForm } from '../routes/AdminAdventureForm';
import { AdminAdventureDetail } from '../routes/AdminAdventureDetail';
import { RequireParent } from '../features/auth/RequireParent';
import { RequireGuest } from '../features/auth/RequireGuest';
import { RequireAdmin } from '../features/auth/RequireAdmin';
import { AdminLayout } from '../features/admin/AdminLayout';

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
/**
 * `three` is the same kind of large, canvas-touching dependency as
 * `phaser` above, so the Phase 31 sandbox route is lazy-loaded for the
 * same reason: keep it out of every other route's bundle and out of the
 * test import graph until a child actually opens it.
 */
const ThreeSandboxWorldPage = lazy(() =>
  import('../routes/ThreeSandboxWorldPage').then((module) => ({
    default: module.ThreeSandboxWorldPage,
  })),
);

/**
 * The one page for every manifest-driven 3D location (engine Phase 6,
 * ADR-025), lazy for the same reason as `ThreeSandboxWorldPage` above: it
 * pulls in `three`. Welcome Harbor was the first region on it.
 */
const LocationWorldPage = lazy(() =>
  import('../routes/LocationWorldPage').then((module) => ({
    default: module.LocationWorldPage,
  })),
);

const StorykeeperCastleWorldPage3D = lazy(() =>
  import('../routes/StorykeeperCastleWorldPage3D').then((module) => ({
    default: module.StorykeeperCastleWorldPage3D,
  })),
);

const WonderwildForestWorldPage3D = lazy(() =>
  import('../routes/WonderwildForestWorldPage3D').then((module) => ({
    default: module.WonderwildForestWorldPage3D,
  })),
);

/**
 * Clockwork Harbor (`docs/regions/clockwork.md`). No `3D` suffix: unlike the
 * bay and the castle, this region has no earlier Phaser route to disambiguate
 * from - it is first-person from its first commit.
 */
const ClockworkHarborWorldPage = lazy(() =>
  import('../routes/ClockworkHarborWorldPage').then((module) => ({
    default: module.ClockworkHarborWorldPage,
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
        path="/island/:childId/world/three-sandbox"
        element={
          <RequireParent>
            <Suspense fallback={<p>Loading the sandbox...</p>}>
              <ThreeSandboxWorldPage />
            </Suspense>
          </RequireParent>
        }
      />
      <Route
        path={LOCATION_WORLD_ROUTE}
        element={
          <RequireParent>
            <Suspense fallback={<p>Loading...</p>}>
              <LocationWorldPage />
            </Suspense>
          </RequireParent>
        }
      />
      {/* Pre-Phase-6 URL, kept working for bookmarks and old links. */}
      <Route
        path="/island/:childId/world/welcome-harbor-3d"
        element={<LegacyLocationWorldRedirect regionId={WELCOME_HARBOR_REGION_ID} />}
      />
      <Route
        path="/island/:childId/world/pirate-builder-bay-3d"
        element={<LegacyLocationWorldRedirect regionId={PIRATE_BUILDER_BAY_REGION_ID} />}
      />
      <Route
        path="/island/:childId/world/wonderwild-forest-3d"
        element={
          <RequireParent>
            <Suspense fallback={<p>Loading Wonderwild Forest...</p>}>
              <WonderwildForestWorldPage3D />
            </Suspense>
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/world/storykeeper-castle-3d"
        element={
          <RequireParent>
            <Suspense fallback={<p>Loading Storykeeper Castle...</p>}>
              <StorykeeperCastleWorldPage3D />
            </Suspense>
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/world/clockwork-harbor"
        element={
          <RequireParent>
            <Suspense fallback={<p>Loading Clockwork Harbor...</p>}>
              <ClockworkHarborWorldPage />
            </Suspense>
          </RequireParent>
        }
      />
      <Route
        path="/island/:childId/travel"
        element={
          <RequireParent>
            <TravelDeck />
          </RequireParent>
        }
      />
      {/*
        Phase 29. Not lazy: a world hub is a card list, and the heavy
        per-world assets (tilemaps, decor, Phaser scenes) are already
        code-split behind the `/world/...` routes above.
      */}
      <Route
        path="/island/:childId/worlds/:worldSlug"
        element={
          <RequireParent>
            <WorldHubPage />
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
      {/* One RequireAdmin gate and one AdminLayout (Tailwind, ADR-023) for every admin page. */}
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="children/:childId" element={<AdminChildProgress />} />
        <Route path="assets" element={<AdminAssets />} />
        <Route path="assets/models" element={<AdminModelAssets />} />
        <Route path="assets/models/new" element={<AdminNewModelAsset />} />
        {/* Islands & Adventures catalog (docs/ISLAND_ADVENTURE_MANAGEMENT.md, ADR-024). */}
        <Route path="islands" element={<AdminIslands />} />
        <Route path="islands/new" element={<AdminIslandForm />} />
        <Route path="islands/:islandId" element={<AdminIslandDetail />} />
        <Route path="islands/:islandId/edit" element={<AdminIslandForm />} />
        <Route path="islands/:islandId/adventures/new" element={<AdminAdventureForm />} />
        <Route path="adventures" element={<AdminAdventures />} />
        <Route path="adventures/new" element={<AdminAdventureForm />} />
        <Route path="adventures/:adventureId" element={<AdminAdventureDetail />} />
        <Route path="adventures/:adventureId/edit" element={<AdminAdventureForm />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
