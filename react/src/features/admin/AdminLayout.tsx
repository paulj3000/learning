import { Link, Outlet } from 'react-router-dom';
import './admin.css';

/**
 * Chrome for `/admin/*`: a top bar and the page's `<main>`. It is the only place `admin.css` is
 * imported and the only element carrying `.admin-root`, the class the scoped Tailwind reset and
 * global.css's button exclusion both key on (ADR-023). Rendered inside `RequireAdmin`, so the
 * not-authorized and loading screens keep the island's own styling.
 *
 * There are no React admin sections any more (AMP-03): every `/admin/*` address shows
 * `AdminMoved`, which points to Django Admin (ADR-034, ADR-043).
 */
export function AdminLayout() {
  return (
    <div className="admin-root flex flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <p className="text-sm font-semibold">Island admin</p>
          <Link className="text-sm font-medium text-primary hover:underline" to="/home">
            Back to my dashboard
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6" id="main-content">
        <Outlet />
      </main>
    </div>
  );
}
