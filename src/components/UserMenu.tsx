import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './UserMenu.module.css';
import { useAuth } from '../features/auth/AuthContext';

/**
 * Account menu for the parent dashboard header: a user icon that opens a
 * dropdown with "Settings" and, last, "Sign out" (CLAUDE.md section 4's
 * "calm engagement" favors one small, predictable control here over a
 * second header button competing for attention). An "Admin" item appears
 * first only for a Cognito `Admins`-group member (`useAuth().isAdmin`) —
 * the actual gate is `RequireAdmin` on the `/admin` route, this is only
 * discoverability for the account that already has access.
 */
export function UserMenu() {
  const { signOut, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        className={styles.trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((current) => !current)}
      >
        <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.418 0-8 2.239-8 5v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-2.761-3.582-5-8-5Z"
          />
        </svg>
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          {isAdmin ? (
            <Link
              className={styles.menuItem}
              role="menuitem"
              to="/admin"
              onClick={() => setOpen(false)}
            >
              Admin
            </Link>
          ) : null}
          <Link
            className={styles.menuItem}
            role="menuitem"
            to="/home/settings"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          <button
            className={styles.menuItemButton}
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
