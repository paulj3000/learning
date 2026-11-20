import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writingRoomLineId, writingRoomSpeechLines } from './writingRoomSpeech';

/** The server's copy of the narration lines must be exactly what the game captions. */
describe('the Writing Room narration lines', () => {
  it('match lai/apps/speech/writing_room_speech.json exactly', () => {
    const path = resolve(process.cwd(), '../lai/apps/speech/writing_room_speech.json');
    const server = JSON.parse(readFileSync(path, 'utf-8')) as {
      lines: { id: string; text: string }[];
    };
    expect(server.lines).toEqual(writingRoomSpeechLines());
  });

  it('are authored lines with unique ids and visible text, and never a child-written one', () => {
    const lines = writingRoomSpeechLines();
    expect(lines.length).toBeGreaterThan(0);
    expect(new Set(lines.map((line) => line.id)).size).toBe(lines.length);
    for (const line of lines) {
      expect(line.text.trim()).not.toBe('');
      expect(line.text).not.toContain('—');
    }
    expect(writingRoomLineId('writing-room-own-story', 'write-the-story')).toBe(
      'writing-room-own-story-write-the-story',
    );
  });
});
