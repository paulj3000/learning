import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  /** A link one level up, shown above the title on nested pages. */
  back?: { to: string; label: string };
  /** Page-level actions, such as an upload button, aligned to the right. */
  actions?: ReactNode;
}

/** The title block at the top of each admin page, inside `AdminLayout`'s `<main>`. */
export function AdminPageHeader({ title, description, back, actions }: AdminPageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        {back ? (
          <Link className="w-fit text-sm font-medium text-primary hover:underline" to={back.to}>
            {back.label}
          </Link>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
