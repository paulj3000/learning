import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SeasonalChips } from './RealmParts';
import { themeFor } from './realmThemes';

const base = { slug: 'christmas', theme: 'CHRISTMAS', featured: false, inWindow: false };

describe('SeasonalChips (NP-023)', () => {
  it('renders nothing for a Realm with no seasonal event', () => {
    const { container } = render(<SeasonalChips seasonal={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a Seasonal chip, and Featured only while featured', () => {
    const { rerender } = render(<SeasonalChips seasonal={base} />);
    expect(screen.getByText('Seasonal')).toBeInTheDocument();
    expect(screen.queryByText('Featured')).not.toBeInTheDocument();
    rerender(<SeasonalChips seasonal={{ ...base, featured: true, inWindow: true }} />);
    expect(screen.getByText('Featured')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('maps the North Pole slugs to the winter scene', () => {
    expect(themeFor('north-pole').scene).toBe('winter');
    expect(themeFor('north-pole-village').scene).toBe('winter');
  });
});
