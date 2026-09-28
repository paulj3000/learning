import { Link, NavLink, Outlet } from 'react-router-dom';
import './admin.css';
import { cn } from './ui/cn';

interface AdminNavItem {
  to: string;
  label: string;
  /** Match only this exact path, so "Families" is not active on /admin/assets. */
  end?: boolean;
}

const ADMIN_NAV: AdminNavItem[] = [
  { to: '/admin', label: 'Families', end: true },
  { to: '/admin/islands', label: 'Islands' },
  { to: '/admin/adventures', label: 'Adventures' },
  { to: '/admin/assets', label: 'Game assets' },
];

/**
 * Chrome shared by every `/admin/*` page: a top bar with the section links
 * and the page's `<main>`. It is the only place `admin.css` is imported and
 * the only element carrying `.admin-root`, the class the scoped Tailwind
 * reset and global.css's button exclusion both key on (ADR-023). Rendered
 * inside `RequireAdmin`, so the not-authorized and loading screens keep the
 * island's own styling.
 */
export function AdminLayout() {
  return (
    <div className="admin-root flex flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="text-sm font-semibold">Island admin</p>
            <nav aria-label="Admin sections" className="flex items-center gap-1">
              {ADMIN_NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                      isActive && 'bg-accent text-accent-foreground',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
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
