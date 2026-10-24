import { IDLE_SNAPSHOT, type MultiplayerSnapshot } from './multiplayerClient';
import { explorerName, PRESENCE_COPY, presenceStatusLine } from './presenceCopy';

const at = (next: Partial<MultiplayerSnapshot>): MultiplayerSnapshot => ({
  ...IDLE_SNAPSHOT,
  ...next,
});

describe('presence copy', () => {
  it('has no em dashes and nothing empty (CLAUDE.md section 13)', () => {
    for (const line of Object.values(PRESENCE_COPY)) {
      expect(line).not.toContain('—');
      expect(line.trim()).not.toBe('');
    }
  });

  it('names explorers by their authored avatar only', () => {
    expect(explorerName('DRAGON')).toBe('Dragon explorer');
    expect(explorerName(null)).toBe('An explorer');
  });

  it('has a line for every status', () => {
    expect(presenceStatusLine(IDLE_SNAPSHOT)).toBeNull();
    expect(presenceStatusLine(at({ status: 'CONNECTING' }))).toBe(PRESENCE_COPY.connecting);
    expect(presenceStatusLine(at({ status: 'CONNECTED' }))).toBe(PRESENCE_COPY.alone);
    expect(presenceStatusLine(at({ status: 'RECONNECTING' }))).toBe(PRESENCE_COPY.reconnecting);
    expect(presenceStatusLine(at({ status: 'FAILED', failure: 'UNAUTHORIZED' }))).toBe(
      PRESENCE_COPY.solo,
    );
    expect(presenceStatusLine(at({ status: 'DISCONNECTED', failure: 'REPLACED' }))).toBe(
      PRESENCE_COPY.replaced,
    );
  });
});
