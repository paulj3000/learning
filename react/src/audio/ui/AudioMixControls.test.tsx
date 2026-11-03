import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../AudioChannels';
import { createSoundManager } from '../SoundManager';
import { SoundProvider } from '../react';
import { FakeEngine } from '../testing/fakes';
import { AudioMixControls, ManagerAudioControls } from '.';

describe('AudioMixControls', () => {
  it('offers a labelled slider and a mute button for everything and each channel', () => {
    render(<AudioMixControls settings={createDefaultSettings()} onChange={vi.fn()} />);
    for (const label of ['Everything', 'Music', 'Ambient', 'Sound effects', 'Voice', 'Interface']) {
      expect(screen.getByRole('slider', { name: label })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: /^mute /i })).toHaveLength(6);
    expect(screen.getByRole('checkbox', { name: /quieter/i })).toBeInTheDocument();
  });

  it('reports the smallest patch for the control used', () => {
    const onChange = vi.fn();
    render(<AudioMixControls settings={createDefaultSettings()} onChange={onChange} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Music' }), { target: { value: '20' } });
    expect(onChange).toHaveBeenLastCalledWith({ channels: { music: { volume: 0.2 } } });
    fireEvent.change(screen.getByRole('slider', { name: 'Everything' }), {
      target: { value: '60' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ masterVolume: 0.6 });
  });

  it('shows a clear muted state and keeps the slider value', () => {
    const settings = createDefaultSettings();
    settings.channels.music = { volume: 0.3, muted: true };
    render(<AudioMixControls settings={settings} onChange={vi.fn()} />);
    const slider = screen.getByRole('slider', { name: 'Music' });
    expect(slider).toHaveValue('30');
    expect(slider).toHaveAttribute('aria-valuetext', 'Music is off');
    expect(screen.getByRole('button', { name: /^mute music/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('works from the keyboard', async () => {
    const onChange = vi.fn();
    render(<AudioMixControls settings={createDefaultSettings()} onChange={onChange} />);
    const button = screen.getByRole('button', { name: /^mute voice/i });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith({ channels: { voice: { muted: true } } });
  });

  it('disables every control while saving', () => {
    render(<AudioMixControls settings={createDefaultSettings()} onChange={vi.fn()} disabled />);
    for (const slider of screen.getAllByRole('slider')) expect(slider).toBeDisabled();
  });
});

describe('ManagerAudioControls', () => {
  function setup() {
    const engine = new FakeEngine();
    const manager = createSoundManager({ engine });
    render(
      <SoundProvider manager={manager} unlockOnGesture={false}>
        <ManagerAudioControls />
      </SoundProvider>,
    );
    return { engine, manager };
  }

  it('changes the live mix at once, without restarting what plays', async () => {
    const { engine, manager } = setup();
    manager.register({ id: 'music.t.loop', channel: 'music', url: 'x', loop: true });
    await manager.play('music.t.loop');
    const voices = engine.voices.length;
    fireEvent.change(screen.getByRole('slider', { name: 'Music' }), { target: { value: '10' } });
    expect(manager.getSettings().channels.music.volume).toBe(0.1);
    expect(engine.channelGains.get('music')).toBe(0.1);
    expect(engine.voices).toHaveLength(voices);
  });

  it('mutes and unmutes a channel, restoring its remembered volume', async () => {
    const { manager } = setup();
    manager.setChannelVolume('sfx', 0.35);
    await act(async () => undefined);
    await userEvent.click(screen.getByRole('button', { name: /^mute sound effects/i }));
    expect(manager.getSettings().channels.sfx).toEqual({ volume: 0.35, muted: true });
    await userEvent.click(screen.getByRole('button', { name: /^mute sound effects/i }));
    expect(manager.getSettings().channels.sfx).toEqual({ volume: 0.35, muted: false });
  });

  it('master mute silences everything at once and unmute restores it', async () => {
    const { engine, manager } = setup();
    manager.setMasterVolume(0.6);
    await act(async () => undefined);
    await userEvent.click(screen.getByRole('button', { name: /^mute everything/i }));
    expect(engine.masterGain).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: /^mute everything/i }));
    expect(engine.masterGain).toBe(0.6);
  });

  it('reduced intensity halves music and ambience but not the saved volumes', async () => {
    const { engine, manager } = setup();
    await userEvent.click(screen.getByRole('checkbox', { name: /quieter/i }));
    expect(engine.channelGains.get('music')).toBe(0.25);
    expect(engine.channelGains.get('ambient')).toBe(0.25);
    expect(engine.channelGains.get('sfx')).toBe(0.8);
    expect(manager.getSettings().channels.music.volume).toBe(0.5);
  });
});
