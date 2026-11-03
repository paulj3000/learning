import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './AppRoutes';
import { ErrorBoundary } from './ErrorBoundary';
import { AuthProvider } from '../features/auth/AuthContext';
import { ChildAudioPreferencesSync } from '../audio/preferences';
import { DjangoAccountProvider } from '../features/auth/DjangoAccountContext';

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <DjangoAccountProvider>
          <BrowserRouter>
            <a className="skip-link" href="#main-content">
              Skip to main content
            </a>
            <ChildAudioPreferencesSync />
            <AppRoutes />
          </BrowserRouter>
        </DjangoAccountProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
