import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  useAppSettings,
  reloadAppSettings,
  normalizeIdleReturnHomeSeconds,
  IDLE_RETURN_HOME_OFF,
  IDLE_RETURN_HOME_MIN_SECONDS,
  IDLE_RETURN_HOME_MAX_SECONDS,
  IDLE_RETURN_HOME_STORAGE_KEY,
} from './appSettings';

/**
 * app/appSettings — the host's own persisted app settings (A7, Issue #144).
 *
 * The Visu had no app-settings store; A7 brings the minimal one its idle return
 * needs. These tests pin the two things a wall panel depends on: the feature is
 * OFF unless somebody switched it on, and the value survives a reload.
 */
describe('appSettings — idleReturnHomeSeconds (A7, #144)', () => {
  beforeEach(() => {
    localStorage.clear();
    reloadAppSettings();
  });

  it('is OFF by default — a panel never jumps away unasked', () => {
    expect(useAppSettings().idleReturnHomeSeconds.value).toBe(IDLE_RETURN_HOME_OFF);
    expect(IDLE_RETURN_HOME_OFF).toBe(0);
  });

  it('persists the configured value across a reload', () => {
    useAppSettings().setIdleReturnHomeSeconds(120);
    expect(localStorage.getItem(IDLE_RETURN_HOME_STORAGE_KEY)).toBe('120');

    // A fresh app start re-reads storage — the setting is not session state.
    reloadAppSettings();
    expect(useAppSettings().idleReturnHomeSeconds.value).toBe(120);
  });

  it('reads a stored value on first access (the persisted floor)', () => {
    localStorage.setItem(IDLE_RETURN_HOME_STORAGE_KEY, '45');
    reloadAppSettings();
    expect(useAppSettings().idleReturnHomeSeconds.value).toBe(45);
  });

  it('treats 0 / empty / garbage as OFF rather than guessing a duration', () => {
    expect(normalizeIdleReturnHomeSeconds(0)).toBe(IDLE_RETURN_HOME_OFF);
    expect(normalizeIdleReturnHomeSeconds('')).toBe(IDLE_RETURN_HOME_OFF);
    expect(normalizeIdleReturnHomeSeconds(null)).toBe(IDLE_RETURN_HOME_OFF);
    expect(normalizeIdleReturnHomeSeconds('nonsense')).toBe(IDLE_RETURN_HOME_OFF);
    expect(normalizeIdleReturnHomeSeconds(-5)).toBe(IDLE_RETURN_HOME_OFF);
  });

  it('clamps a non-zero value into the sensible window and rounds to whole seconds', () => {
    expect(normalizeIdleReturnHomeSeconds(3)).toBe(IDLE_RETURN_HOME_MIN_SECONDS);
    expect(normalizeIdleReturnHomeSeconds(999999)).toBe(IDLE_RETURN_HOME_MAX_SECONDS);
    expect(normalizeIdleReturnHomeSeconds('90.6')).toBe(91);
    expect(IDLE_RETURN_HOME_MIN_SECONDS).toBe(10);
    expect(IDLE_RETURN_HOME_MAX_SECONDS).toBe(3600);
  });

  it('a garbage value in storage degrades to OFF, never to a random timeout', () => {
    localStorage.setItem(IDLE_RETURN_HOME_STORAGE_KEY, 'not-a-number');
    reloadAppSettings();
    expect(useAppSettings().idleReturnHomeSeconds.value).toBe(IDLE_RETURN_HOME_OFF);
  });

  describe('with a broken localStorage (private mode / storage disabled)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('still applies the setting in memory instead of crashing the app', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      expect(() => useAppSettings().setIdleReturnHomeSeconds(30)).not.toThrow();
      expect(useAppSettings().idleReturnHomeSeconds.value).toBe(30);
    });

    it('starts OFF when reading storage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(() => reloadAppSettings()).not.toThrow();
      expect(useAppSettings().idleReturnHomeSeconds.value).toBe(IDLE_RETURN_HOME_OFF);
    });
  });
});
