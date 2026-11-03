import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AudioSettingsApi } from '../../api/audio/audioSettingsApi';
import { createDefaultSettings } from '../../audio/AudioChannels';
import type { SoundSettings } from '../../audio/AudioTypes';
import { ParentAudioSettings } from './ParentAudioSettings';

const apiWith = (settings = createDefaultSettings()): AudioSettingsApi => ({
  get: vi.fn(async () => settings),
  save: vi.fn(async (s) => s),
});

describe('ParentAudioSettings', () => {
  it('loads this child’s mix and saves only after a change, to this child only', async () => {
    const apis = new Map([
      ['kid-1', apiWith()],
      ['kid-2', apiWith()],
    ]);
    const apiFor = (id: string) => apis.get(id) ?? null;
    render(<ParentAudioSettings childId="kid-1" apiFor={apiFor} />);
    const save = await screen.findByRole('button', { name: 'Save sound settings' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('slider', { name: 'Music' }), { target: { value: '15' } });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(await screen.findByText('Sound settings saved.')).toBeInTheDocument();
    const sent = vi.mocked(apis.get('kid-1')!.save).mock.calls[0]?.[0] as SoundSettings;
    expect(sent.channels.music.volume).toBe(0.15);
    expect(apis.get('kid-2')!.save).not.toHaveBeenCalled();
  });

  it('says so calmly when the settings cannot be reached', async () => {
    const api: AudioSettingsApi = {
      get: vi.fn(async () => {
        throw new Error('offline');
      }),
      save: vi.fn(),
    };
    render(<ParentAudioSettings childId="k" apiFor={() => api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach/i);
  });

  it('says it is unavailable in a build without the Django API', async () => {
    render(<ParentAudioSettings childId="k" apiFor={() => null} />);
    expect(await screen.findByText(/not available here/i)).toBeInTheDocument();
  });

  it('reports a failed save and keeps the change on screen', async () => {
    const api = apiWith();
    vi.mocked(api.save).mockRejectedValueOnce(new Error('no'));
    render(<ParentAudioSettings childId="k" apiFor={() => api} />);
    await screen.findByRole('button', { name: 'Save sound settings' });
    fireEvent.change(screen.getByRole('slider', { name: 'Voice' }), { target: { value: '40' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save sound settings' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('slider', { name: 'Voice' })).toHaveValue('40');
  });
});
