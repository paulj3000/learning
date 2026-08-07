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
import { WelcomeHarbor } from '../routes/WelcomeHarbor';
import { IslandLocationPage } from '../routes/IslandLocationPage';
import { AdventurePage } from '../routes/AdventurePage';
import { AdventureLog } from '../routes/AdventureLog';
import { RequireParent } from '../features/auth/RequireParent';
import { RequireGuest } from '../features/auth/RequireGuest';

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
        path="/island/:childId"
        element={
          <RequireParent>
            <WelcomeHarbor />
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
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
