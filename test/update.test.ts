import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paths } from '../src/store/paths.js';
import {
  CHECK_EVERY_MS,
  isNewer,
  noticeFor,
  readUpdate,
  recordCheck,
  runUpdateCheck,
  shouldCheck,
} from '../src/update/check.js';
import { tempStore } from './helpers.js';

let store: ReturnType<typeof tempStore>;

beforeEach(() => {
  store = tempStore();
  delete process.env['PLANX_NO_UPDATE_CHECK'];
  delete process.env['CI'];
});

afterEach(() => {
  store.cleanup();
  vi.unstubAllGlobals();
  delete process.env['PLANX_NO_UPDATE_CHECK'];
  delete process.env['CI'];
});

/** Write the cache the way a check would have. */
function seed(latest: string | null, checkedAt = new Date().toISOString()): void {
  writeFileSync(
    paths.update(),
    JSON.stringify({ format_version: 1, latest, checked_at: checkedAt }),
    'utf8',
  );
}

function cache(): { latest: string | null; checked_at: string } {
  return JSON.parse(readFileSync(paths.update(), 'utf8'));
}

describe('isNewer', () => {
  const table: Array<[candidate: string, current: string, newer: boolean]> = [
    ['0.4.0', '0.4.0', false],
    ['0.4.1', '0.4.0', true],
    ['0.4.0', '0.4.1', false],
    ['0.5.0', '0.4.9', true],
    ['1.0.0', '0.99.99', true],
    // Ten is a bigger number than nine, which string comparison disagrees with.
    ['0.10.0', '0.9.0', true],
    // A prerelease loses to its own release…
    ['0.5.0-staging.3', '0.5.0', false],
    ['0.5.0', '0.5.0-staging.3', true],
    // …and beats the release below it, so a staging build is told when its
    // own release lands and never told about the one it is already ahead of.
    ['0.5.0-staging.3', '0.4.0', true],
    ['0.4.0', '0.5.0-staging.3', false],
    ['0.5.0-staging.4', '0.5.0-staging.3', true],
    ['0.5.0-staging.3', '0.5.0-staging.4', false],
    // A leading v is what a git tag looks like, and costs nothing to accept.
    ['v0.5.0', '0.4.0', true],
  ];

  for (const [candidate, current, newer] of table) {
    it(`${candidate} over ${current} is ${newer}`, () => {
      expect(isNewer(candidate, current)).toBe(newer);
    });
  }
});

describe('readUpdate', () => {
  it('is null when nothing has ever been checked', () => {
    expect(readUpdate('0.4.0')).toBeNull();
  });

  it('is null when the cache knows of nothing newer', () => {
    seed('0.4.0');
    expect(readUpdate('0.4.0')).toBeNull();
    expect(readUpdate('0.5.0')).toBeNull();
  });

  it('reports the cached version when it is ahead', () => {
    seed('0.5.0');
    expect(readUpdate('0.4.0')).toBe('0.5.0');
  });

  /**
   * The rest of the store treats a schema failure as a reason to stop. A
   * corrupt note about npm is not worth failing `planx list` over.
   */
  it('is null for an unreadable cache rather than throwing', () => {
    writeFileSync(paths.update(), 'not json at all', 'utf8');
    expect(readUpdate('0.4.0')).toBeNull();

    writeFileSync(paths.update(), JSON.stringify({ nonsense: true }), 'utf8');
    expect(readUpdate('0.4.0')).toBeNull();
  });

  it('is null when a check ran but found nothing', () => {
    recordCheck(null);
    expect(cache().latest).toBeNull();
    expect(readUpdate('0.4.0')).toBeNull();
  });
});

describe('the spawn gate', () => {
  it('never checks when there is no terminal', () => {
    expect(shouldCheck(false)).toBe(false);
  });

  it('checks when nothing has been cached yet', () => {
    expect(shouldCheck(true)).toBe(true);
  });

  it('holds off while the cache is fresh, and goes again once it is not', () => {
    seed('0.4.0');
    expect(shouldCheck(true)).toBe(false);

    seed('0.4.0', new Date(Date.now() - CHECK_EVERY_MS - 1000).toISOString());
    expect(shouldCheck(true)).toBe(true);
  });

  it('is silenced by PLANX_NO_UPDATE_CHECK and by CI', () => {
    process.env['PLANX_NO_UPDATE_CHECK'] = '1';
    expect(shouldCheck(true)).toBe(false);
    delete process.env['PLANX_NO_UPDATE_CHECK'];

    process.env['CI'] = 'true';
    expect(shouldCheck(true)).toBe(false);
  });
});

describe('running the check', () => {
  it('writes what the registry says', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ latest: '0.9.1', staging: '0.9.2-s.1' }))),
    );

    await runUpdateCheck();

    expect(cache().latest).toBe('0.9.1');
    expect(readUpdate('0.4.0')).toBe('0.9.1');
  });

  /**
   * The stamp is the point. Without it an offline machine spawns a process on
   * every single run, forever, to fail in exactly the same way.
   */
  it('stamps the check even when the network is gone, and forgets nothing', async () => {
    seed('0.5.0', new Date(0).toISOString());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org');
      }),
    );

    await expect(runUpdateCheck()).resolves.toBeUndefined();

    expect(cache().latest).toBe('0.5.0');
    expect(Date.parse(cache().checked_at)).toBeGreaterThan(0);
    expect(shouldCheck(true)).toBe(false);
  });

  it('treats a registry error and a junk body as no answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('gateway timeout', { status: 504 })),
    );
    await runUpdateCheck();
    expect(cache().latest).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ beta: '1.0.0' }))),
    );
    await runUpdateCheck();
    expect(cache().latest).toBeNull();
  });
});

describe('the notice text', () => {
  it('says what is available and what to run', () => {
    expect(noticeFor('0.5.0')).toEqual({
      long: 'v0.5.0 is available · run planx update',
      short: 'v0.5.0 is available',
    });
  });
});

describe('the store it writes into', () => {
  it('is update.json beside config.json', () => {
    expect(paths.update()).toBe(join(store.dir, 'update.json'));
  });
});
