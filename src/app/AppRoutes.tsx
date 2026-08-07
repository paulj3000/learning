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
import { ChildModePlaceholder } from '../routes/ChildModePlaceholder';
import { RequireParent } from '../features/auth/RequireParent';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/sign-up" element={<SignUp />} />
      <Route path="/sign-in" element={<SignIn />} />
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
        path="/island/:childId"
        element={
          <RequireParent>
            <ChildModePlaceholder />
          </RequireParent>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
