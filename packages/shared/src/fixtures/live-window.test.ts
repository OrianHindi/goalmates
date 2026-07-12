import { describe, expect, it } from 'vitest';
import { LIVE_WINDOW_MS, isWithinLiveWindow } from './live-window';

const HOUR = 60 * 60 * 1000;

describe('isWithinLiveWindow', () => {
  const kickoff = new Date('2026-08-01T18:00:00.000Z');

  it('is false well before kickoff', () => {
    expect(isWithinLiveWindow(kickoff, new Date(kickoff.getTime() - HOUR))).toBe(false);
  });

  it('is false one millisecond before kickoff', () => {
    expect(isWithinLiveWindow(kickoff, new Date(kickoff.getTime() - 1))).toBe(false);
  });

  it('is true at the exact moment of kickoff', () => {
    expect(isWithinLiveWindow(kickoff, kickoff)).toBe(true);
  });

  it('is true partway through a normal match (45 minutes in)', () => {
    expect(isWithinLiveWindow(kickoff, new Date(kickoff.getTime() + 45 * 60 * 1000))).toBe(true);
  });

  it('is true near the end of the window (extra time / penalties territory)', () => {
    expect(isWithinLiveWindow(kickoff, new Date(kickoff.getTime() + LIVE_WINDOW_MS - 1))).toBe(true);
  });

  it('is true at the exact boundary of the window', () => {
    expect(isWithinLiveWindow(kickoff, new Date(kickoff.getTime() + LIVE_WINDOW_MS))).toBe(true);
  });

  it('is false just past the window', () => {
    expect(isWithinLiveWindow(kickoff, new Date(kickoff.getTime() + LIVE_WINDOW_MS + 1))).toBe(false);
  });

  it('is false long after the window (e.g. a stuck LIVE fixture from days ago)', () => {
    expect(isWithinLiveWindow(kickoff, new Date(kickoff.getTime() + 3 * 24 * HOUR))).toBe(false);
  });
});
