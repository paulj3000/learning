import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './AppRoutes';
import { ErrorBoundary } from './ErrorBoundary';

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <AppRoutes />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
