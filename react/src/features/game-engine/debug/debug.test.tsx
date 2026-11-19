import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineRuntime } from '@lai/game-engine/core';
import { createGameplayEventFactory } from '@lai/game-engine/contracts';
import { DebugOverlay } from './DebugOverlay';
import { EventLog } from './EventLog';
import { describeEvent, semanticIdsOf, useEventLog } from './useEventLog';

describe('DebugOverlay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders snapshot values and refreshes on an interval, not per frame', () => {
    const runtime = createEngineRuntime({ id: 'dbg' });
    runtime.diagnostics.recordFrame(20, 0.5);
    runtime.diagnostics.gauge('entities', 7);
    runtime.diagnostics.gauge('resources', 3);
    runtime.diagnostics.gauge('renderer.drawCalls', 12);
    runtime.diagnostics.warn('SLOW_THING', {});
    runtime.diagnostics.warn('SLOW_THING', {});
    runtime.systems.setTiming(true);
    const spy = vi.spyOn(runtime.diagnostics, 'snapshot');
    render(<DebugOverlay runtime={runtime} intervalMs={500} collisionVisible={false} onCollisionVisibleChange={() => {}} />);
    expect(screen.getByTestId('debug-fps')).toHaveTextContent('50');
    expect(screen.getByTestId('debug-frame-ms')).toHaveTextContent('20.0');
    expect(screen.getByTestId('debug-dropped')).toHaveTextContent('0.50');
    expect(screen.getByTestId('debug-entities')).toHaveTextContent('7');
    expect(screen.getByTestId('debug-resources')).toHaveTextContent('3');
    expect(screen.getByText('drawCalls')).toBeInTheDocument();
    expect(screen.getByTestId('debug-warnings')).toHaveTextContent('SLOW_THING x2');
    const initial = spy.mock.calls.length;
    runtime.diagnostics.gauge('entities', 9);
    expect(screen.getByTestId('debug-entities')).toHaveTextContent('7');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('debug-entities')).toHaveTextContent('9');
    expect(spy.mock.calls.length).toBe(initial + 1);
  });

  it('shows placeholders without a runtime and reports the collision toggle', async () => {
    vi.useRealTimers();
    const onChange = vi.fn();
    render(<DebugOverlay runtime={null} collisionVisible={false} onCollisionVisibleChange={onChange} />);
    expect(screen.getByTestId('debug-fps')).toHaveTextContent('-');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show collision' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('EventLog', () => {
  const factory = createGameplayEventFactory({ realmId: 'realm.test', adventureId: 'adv.test', areaId: null, sessionRef: null });

  it('extracts semantic ids only', () => {
    expect(semanticIdsOf({ collectibleId: 'coin.1', setId: null, childName: 'Ada', note: 'x' })).toEqual(['coin.1']);
    expect(
      semanticIdsOf({ learningRef: { kind: 'CHEST_CHALLENGE', chestEntityId: 'chest.1', challengeAttemptId: 'att.1' } }),
    ).toEqual(['chest.1', 'att.1']);
  });

  it('describes valid, invalid and engine events without echoing invalid data', () => {
    const ok = describeEvent('gameplay.event', factory.create('puzzle.completed', { puzzleId: 'p.1' }), 1);
    expect(ok).toMatchObject({ kind: 'gameplay', type: 'puzzle.completed', ids: ['p.1'], dropped: false });
    const bad = describeEvent('gameplay.event', { type: 'x', childName: 'Ada' }, 2);
    expect(bad).toEqual({ seq: 2, kind: 'gameplay', type: 'invalid claim', ids: [], dropped: true });
    expect(describeEvent('PlayerEnteredZone', { zoneId: 'zone.a' }, 3)).toMatchObject({ kind: 'engine', ids: ['zone.a'] });
  });

  it('keeps the last N events, newest first in the panel', () => {
    const runtime = createEngineRuntime({ id: 'log' });
    const { result } = renderHook(() => useEventLog(runtime, 2));
    act(() => {
      runtime.events.emit('PlayerJumped' as never, { airJump: false } as never);
      runtime.events.emit('PlayerEnteredZone' as never, { zoneId: 'zone.a' } as never);
      runtime.events.emit('PlayerLeftZone' as never, { zoneId: 'zone.a' } as never);
    });
    expect(result.current.entries.map((e) => e.type)).toEqual(['PlayerEnteredZone', 'PlayerLeftZone']);
    render(<EventLog entries={result.current.entries} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('PlayerLeftZone');
    expect(items[0]).toHaveTextContent('zone.a');
  });

  it('shows an empty state', () => {
    render(<EventLog entries={[]} />);
    expect(screen.getByText('No events yet.')).toBeInTheDocument();
  });
});
