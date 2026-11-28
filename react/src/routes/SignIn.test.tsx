import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SignIn } from './SignIn';

vi.mock('../lib/cognito', () => ({
  cognitoAuth: () => ({ signIn: vi.fn() }),
  createChildCognitoAuth: vi.fn(),
  isCognitoConfigured: true,
  isChildCognitoConfigured: true,
}));
vi.mock('../features/child-auth/ChildSessionContext', () => ({
  useChildSession: () => ({ status: 'signedOut', child: null, adopt: vi.fn() }),
}));

describe('the sign-in landing page', () => {
  it('shows a child sign-in and a parent sign-in as two labelled sections', () => {
    render(
      <MemoryRouter>
        <SignIn />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    const child = screen.getByRole('form', { name: 'I am a child' });
    expect(within(child).getByLabelText('Username')).toBeInTheDocument();
    expect(within(child).getByLabelText('Password')).toBeInTheDocument();
    expect(within(child).getByLabelText('Remember me on this device')).not.toBeChecked();
    expect(within(child).getByRole('button', { name: 'Start my adventure' })).toBeInTheDocument();

    const parent = screen.getByRole('form', { name: 'I am a parent or grown-up' });
    expect(within(parent).getByLabelText('Email address')).toBeInTheDocument();
    expect(within(parent).getByLabelText('Password')).toBeInTheDocument();
    expect(within(parent).getByRole('button', { name: 'Family dashboard' })).toBeInTheDocument();
    expect(within(parent).getByRole('link', { name: /forgot your password/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(within(parent).getByRole('link', { name: /create an account/i })).toHaveAttribute(
      'href',
      '/sign-up',
    );
  });
});
