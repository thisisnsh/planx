import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreCorruptionError } from '../src/store/atomic.js';
import { contentHash, planId, slugify, ulid } from '../src/store/ids.js';
import { paths } from '../src/store/paths.js';
import {
  addVersion,
  createPlan,
  listPlans,
  listTrash,
  PlanNotFoundError,
  readLocks,
  readMeta,
  readVersions,
  rebuildIndex,
  reindex,
  renamePlan,
  resolvePlanRef,
  resolveVersionRef,
  restorePlan,
  trashPlan,
  trimVersions,
  VersionNotFoundError,
  writeMeta,
} from '../src/store/plans.js';
import { SAMPLE_PLAN, tempStore } from './helpers.js';

let store: ReturnType<typeof tempStore>;

beforeEach(() => {
  store = tempStore();
});
afterEach(() => {
  store.cleanup();
});

function seed(title = 'Guard clock regression', content = SAMPLE_PLAN) {
  const meta = createPlan({ title, content, source: 'test', cwd: '/work/repo' });
  addVersion(meta.id, content);
  return meta.id;
}

describe('ids', () => {
  it('builds greppable plan ids from title plus a content hash', () => {
    const id = planId('Guard the clock regression!', 'body');
    expect(id).toMatch(/^guard-the-clock-regression-[0-9a-f]{4}$/);
  });

  it('caps slugs at six words so ids stay tab-completable', () => {
    expect(slugify('one two three four five six seven eight')).toBe('one-two-three-four-five-six');
  });

  it('falls back to "plan" when a title slugifies to nothing', () => {
    expect(slugify('###  ***')).toBe('plan');
  });

  it('hashes trailing whitespace away but nothing else', () => {
    expect(contentHash('a  \nb')).toBe(contentHash('a\nb'));
    expect(contentHash('a\nb')).not.toBe(contentHash('a\n b'));
  });

  it('emits ulids that sort chronologically', () => {
    const early = ulid(1_700_000_000_000);
    const late = ulid(1_800_000_000_000);
    expect(early.length).toBe(26);
    expect(early < late).toBe(true);
  });
});

describe('plan lifecycle', () => {
  it('creates a plan directory with meta, versions and locks', () => {
    const id = seed();
    expect(existsSync(paths.meta(id))).toBe(true);
    expect(existsSync(paths.versions(id))).toBe(true);
    expect(existsSync(paths.locks(id))).toBe(true);
    expect(readFileSync(paths.versionFile(id, 1), 'utf8')).toContain('## Approach');
  });

  it('treats a byte-identical capture as a no-op', () => {
    const id = seed();
    const again = addVersion(id, SAMPLE_PLAN);
    expect(again.created).toBe(false);
    expect(again.version).toBe(1);
    expect(readVersions(id).versions).toHaveLength(1);
  });

  it('records a new version when content changes, with a parent link', () => {
    const id = seed();
    const v2 = addVersion(id, `${SAMPLE_PLAN}\n## Risks\nNone yet.\n`);
    expect(v2).toMatchObject({ version: 2, created: true });
    expect(v2.record.parent).toBe(1);
  });

  it('does not rewind latest when a revision reverts to older content', () => {
    const id = seed();
    addVersion(id, `${SAMPLE_PLAN}\nextra\n`);
    const back = addVersion(id, SAMPLE_PLAN);
    expect(back.version).toBe(3);
  });

  it('honours an explicit --name over the hashed id', () => {
    const meta = createPlan({ title: 'Whatever', content: 'x', name: 'My Pinned Name' });
    expect(meta.id).toBe('my-pinned-name');
  });

  it('disambiguates colliding explicit names', () => {
    createPlan({ title: 'a', content: 'x', name: 'dupe' });
    expect(createPlan({ title: 'b', content: 'y', name: 'dupe' }).id).toBe('dupe-2');
  });
});

describe('version refs', () => {
  it('accepts every documented form', () => {
    const id = seed();
    addVersion(id, `${SAMPLE_PLAN}\nsecond\n`);
    addVersion(id, `${SAMPLE_PLAN}\nthird\n`);
    const sha = readVersions(id).versions.find((v) => v.n === 2)!.sha256;

    expect(resolveVersionRef(id, 'latest')).toBe(3);
    expect(resolveVersionRef(id, undefined)).toBe(3);
    expect(resolveVersionRef(id, 'prev')).toBe(2);
    expect(resolveVersionRef(id, '~2')).toBe(1);
    expect(resolveVersionRef(id, 'v2')).toBe(2);
    expect(resolveVersionRef(id, '2')).toBe(2);
    expect(resolveVersionRef(id, 'first')).toBe(1);
    expect(resolveVersionRef(id, sha.slice(0, 8))).toBe(2);
  });

  it('rejects a version that does not exist', () => {
    const id = seed();
    expect(() => resolveVersionRef(id, 'v9')).toThrow(VersionNotFoundError);
  });
});

describe('plan refs', () => {
  it('resolves by exact id, prefix and title substring', () => {
    const id = seed('Guard clock regression');
    expect(resolvePlanRef(id)).toBe(id);
    expect(resolvePlanRef('guard-clock')).toBe(id);
    expect(resolvePlanRef('CLOCK REGRESSION')).toBe(id);
  });

  it('refuses an ambiguous prefix rather than guessing', () => {
    createPlan({ title: 'a', content: 'x', name: 'shared-prefix-one' });
    createPlan({ title: 'b', content: 'y', name: 'shared-prefix-two' });
    expect(() => resolvePlanRef('shared-prefix')).toThrow(/matches 2 plans/);
  });

  it('reports a missing plan clearly', () => {
    expect(() => resolvePlanRef('nope')).toThrow(PlanNotFoundError);
  });
});

describe('listing and index', () => {
  it('filters by cwd and approval', () => {
    const id = seed();
    expect(listPlans({ here: true })).toHaveLength(0); // seeded with /work/repo
    expect(listPlans({ unapproved: true }).map((p) => p.id)).toEqual([id]);
    expect(listPlans({ approved: true })).toHaveLength(0);
  });

  it('filters by age against the last update, not the read time', () => {
    const fresh = seed('Fresh plan');
    const stale = seed('Stale plan', `${SAMPLE_PLAN}\ndifferent\n`);

    const meta = readMeta(stale)!;
    meta.updated = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    writeMeta(meta);
    reindex(stale);

    expect(listPlans({ olderThanMs: 30 * 24 * 60 * 60 * 1000 }).map((p) => p.id)).toEqual([stale]);
    expect(
      listPlans()
        .map((p) => p.id)
        .sort(),
    ).toEqual([fresh, stale].sort());
  });

  it('lists a plan whose index row was lost', () => {
    const id = seed();
    writeFileSync(paths.index(), JSON.stringify({ format_version: 1, plans: {} }));
    expect(listPlans().map((p) => p.id)).toEqual([id]);
    expect(rebuildIndex()).toBe(1);
    expect(listPlans()).toHaveLength(1);
  });
});

describe('rename, trash and restore', () => {
  it('renames the directory and reindexes', () => {
    const id = seed();
    const next = renamePlan(id, 'Clock guard, take two');
    expect(next).toBe('clock-guard-take-two');
    expect(readMeta(next)?.title).toBe('Clock guard, take two');
    expect(listPlans().map((p) => p.id)).toEqual([next]);
  });

  it('soft deletes to trash and restores', () => {
    const id = seed();
    trashPlan(id);
    expect(listPlans()).toHaveLength(0);
    expect(listTrash().map((t) => t.id)).toEqual([id]);

    restorePlan(id);
    expect(listPlans().map((p) => p.id)).toEqual([id]);
    expect(existsSync(paths.versionFile(id, 1))).toBe(true);
  });
});

describe('trimming history', () => {
  it('keeps the newest N and never removes a protected version', () => {
    const id = seed();
    for (let i = 2; i <= 5; i++) addVersion(id, `${SAMPLE_PLAN}\nrev ${i}\n`);
    const removed = trimVersions(id, 2, new Set([1]));
    expect(removed).toEqual([2, 3]);
    expect(readVersions(id).versions.map((v) => v.n)).toEqual([1, 4, 5]);
    expect(existsSync(paths.versionFile(id, 1))).toBe(true);
    expect(existsSync(paths.versionFile(id, 2))).toBe(false);
  });
});

describe('corruption', () => {
  it('refuses to silently reset a file that fails its schema', () => {
    const id = seed();
    writeFileSync(paths.locks(id), '{"locks": "not an object"}');
    expect(() => readLocks(id)).toThrow(StoreCorruptionError);
  });

  it('refuses to silently reset a file that is not JSON at all', () => {
    const id = seed();
    writeFileSync(paths.versions(id), 'truncated mid-writ');
    expect(() => readVersions(id)).toThrow(StoreCorruptionError);
  });
});
