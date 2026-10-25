import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDjangoAdminLink } from '../../components/useDjangoAdminLink';
import { useAuth } from './AuthContext';
import { DjangoAccountProvider, useDjangoAccount } from './DjangoAccountContext';

vi.mock('./AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/auth', () => ({ getAccessToken: vi.fn(async () => 'access-token') }));

const useAuthMock = vi.mocked(useAuth);
const DJANGO = { enabled: true as const, baseUrl: 'https://api.example.test' };
const ADMIN_URL = 'https://admin.example.test/admin/';

function auth(status: 'authenticated' | 'unauthenticated', userId: string | null = 'parent-1') {
  useAuthMock.mockReturnValue({
    status,
    userId: status === 'authenticated' ? userId : null,
    // An Amplify Admins-group flag must not make anyone Django staff.
    isAdmin: true,
    isSuperuser: true,
    refresh: vi.fn(),
    signOut: vi.fn(),
  });
}

function djangoReplies(body: unknown, status = 201) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function Probe() {
  const { accountId, djangoAdmin } = useDjangoAccount();
  const link = useDjangoAdminLink(ADMIN_URL);
  return (
    <p>
      {accountId ?? 'none'} {djangoAdmin ? 'staff' : 'not-staff'} {link ?? 'no-link'}
    </p>
  );
}

function renderProvider(config: Parameters<typeof DjangoAccountProvider>[0]['config'] = DJANGO) {
  return render(
    <DjangoAccountProvider config={config}>
      <Probe />
    </DjangoAccountProvider>,
  );
}

describe('DjangoAccountProvider', () => {
  beforeEach(() => auth('authenticated'));
  afterEach(() => vi.unstubAllGlobals());

  it('creates the Django account on sign-in with one POST /me/', async () => {
    const fetchMock = djangoReplies({ id: 'account-1', django_admin: false });
    renderProvider();
    await waitFor(() => expect(screen.getByText(/account-1/)).toBeInTheDocument());
    expect(screen.getByText(/not-staff no-link/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/me/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    );
  });

  it('shows the admin link only when Django reports staff', async () => {
    djangoReplies({ id: 'account-1', django_admin: true });
    renderProvider();
    await waitFor(() =>
      expect(screen.getByText(`account-1 staff ${ADMIN_URL}`)).toBeInTheDocument(),
    );
  });

  it('keeps the app usable when provisioning fails', async () => {
    const fetchMock = djangoReplies({ error: { code: 'authentication_unavailable' } }, 503);
    renderProvider();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText('none not-staff no-link')).toBeInTheDocument();
  });

  it('asks Django again for a different signed-in parent', async () => {
    const fetchMock = djangoReplies({ id: 'account-1', django_admin: true });
    const view = renderProvider();
    await waitFor(() => expect(screen.getByText(/account-1 staff/)).toBeInTheDocument());

    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ id: 'account-2', django_admin: false })),
    );
    auth('authenticated', 'parent-2');
    view.rerender(
      <DjangoAccountProvider config={DJANGO}>
        <Probe />
      </DjangoAccountProvider>,
    );
    await waitFor(() => expect(screen.getByText(/account-2 not-staff/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never calls Django when signed out or in a build without the Django API', () => {
    const fetchMock = djangoReplies({ id: 'account-1', django_admin: true });
    renderProvider({ enabled: false });
    auth('unauthenticated');
    renderProvider();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByText('none not-staff no-link')).toHaveLength(2);
  });

  it('is the signed-out value outside a provider', () => {
    render(<Probe />);
    expect(screen.getByText('none not-staff no-link')).toBeInTheDocument();
  });
});
