import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the landing page', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: /an island that grows/i }),
    ).toBeInTheDocument();
  });

  it('provides a skip link to the main content', () => {
    render(<App />);

    const skipLink = screen.getByRole('link', { name: /skip to main content/i });
    expect(skipLink).toHaveAttribute('href', '#main-content');
  });
});
