import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previousStoredVersion } from '../src/cli/commands.js';
import { StoreCorruptionError } from '../src/store/atomic.js';
import {
  defaultConfig,
  readConfig,
  readHints,
  writeConfig,
  writeHints,
} from '../src/store/config.js';
import { readDefaults, writeDefault } from '../src/store/defaults.js';
import { contentHash, planId, slugify, ulid } from '../src/store/ids.js';
import { paths } from '../src/store/paths.js';
import {
  addVersion,
  createPlan,
  latestVersion,
  listPlans,
  markExecuted,
  PlanNotFoundError,
  readMeta,
  readVersions,
  purgePlan,
  rebuildIndex,
  reindex,
  removeVersions,
  readVersionText,
  resolvePlanRef,
  resolveVersionRef,
  rewriteVersion,
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

  it('stays monotonic within a single millisecond', () => {
    // Two records written in the same millisecond must still have a defined
    // order — otherwise "the reviewer's latest verdict" is a coin flip.
    const ids = Array.from({ length: 50 }, () => ulid(1_700_000_000_000));
    expect(new Set(ids).size).toBe(50);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('plan lifecycle', () => {
  it('creates a plan directory with meta and versions', () => {
    const id = seed();
    expect(existsSync(paths.meta(id))).toBe(true);
    expect(existsSync(paths.versions(id))).toBe(true);
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

  it('carries the session that wrote a version, and how it was started', () => {
    const id = seed();
    const v2 = addVersion(id, `${SAMPLE_PLAN}\nextra\n`, {
      sessionId: 'sess-42',
      agent: 'claude',
      agentArgv: ['--model', 'opus'],
    });
    expect(v2.record).toMatchObject({
      session_id: 'sess-42',
      agent: 'claude',
      agent_argv: ['--model', 'opus'],
    });

    // Off disk, not out of the return value: forking happens in another process.
    const stored = readVersions(id).versions.find((v) => v.n === 2);
    expect(stored).toMatchObject({ session_id: 'sess-42', agent_argv: ['--model', 'opus'] });
  });

  /**
   * The three fields are optional with a default for the same reason `edits`
   * was: a store written by an older planx still parses under this one, so
   * nothing here is a `FORMAT_VERSION` bump.
   */
  it('parses a store written before any of them existed', () => {
    const id = seed();
    writeFileSync(
      paths.versions(id),
      JSON.stringify({
        format_version: 1,
        versions: [{ n: 1, sha256: 'abc', created: '2020-01-01T00:00:00.000Z' }],
      }),
    );
    expect(readVersions(id).versions[0]).toMatchObject({ session_id: null, agent_argv: [] });

    writeFileSync(paths.meta(id), JSON.stringify({ id, title: 'Old', created: 'x', updated: 'x' }));
    expect(readMeta(id)?.executed).toBe(null);
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
  it('resolves the exact id, and only that', () => {
    const id = seed('Guard clock regression');
    expect(resolvePlanRef(id)).toBe(id);
  });

  /**
   * A prefix resolved to whichever plan happened to be the only one starting
   * with it, so the same reference opened a different plan the week a second
   * one landed. A refusal is visible; the wrong plan is not.
   */
  it('refuses a prefix and a title substring rather than guessing', () => {
    const id = seed('Guard clock regression');
    expect(() => resolvePlanRef('guard-clock')).toThrow(PlanNotFoundError);
    expect(() => resolvePlanRef('CLOCK REGRESSION')).toThrow(PlanNotFoundError);
    expect(() => resolvePlanRef(id.slice(0, -1))).toThrow(PlanNotFoundError);
  });

  it('reports a missing plan clearly', () => {
    expect(() => resolvePlanRef('nope')).toThrow(PlanNotFoundError);
  });
});

describe('listing and index', () => {
  it('filters by cwd', () => {
    const id = seed();
    expect(listPlans({ here: true })).toHaveLength(0); // seeded with /work/repo
    expect(listPlans().map((p) => p.id)).toEqual([id]);
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

describe('marking a plan executed', () => {
  it('records the version and reaches the index row the picker reads', () => {
    const id = seed();
    addVersion(id, `${SAMPLE_PLAN}\nrev 2\n`, { agent: 'claude' });

    markExecuted(id, 2);
    expect(readMeta(id)?.executed).toMatchObject({ version: 2, agent: 'claude' });
    expect(listPlans()[0]?.executed).toBe(2);

    // Twice is not a failure: an execute picked up after a break should not
    // have to care whether it already said so.
    //
    // The clock is held rather than trusted. Both calls land in the same
    // millisecond whenever the machine is quick enough, and a restamp that has
    // to be slower than the filesystem to be observed is a flake, not a test.
    const first = readMeta(id)!.executed!.at;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.parse(first) + 60_000);
      markExecuted(id, 2);
    } finally {
      vi.useRealTimers();
    }

    const again = readMeta(id)?.executed;
    expect(again?.at).not.toBe(first);
    expect(again).toMatchObject({ version: 2, agent: 'claude' });
  });

  it('survives a rebuild from the plan directories', () => {
    const id = seed();
    markExecuted(id, 1);
    rebuildIndex();
    expect(listPlans()[0]?.executed).toBe(1);
  });

  it('records the building session on the version, not on the plan', () => {
    const id = seed();
    addVersion(id, `${SAMPLE_PLAN}\nrev 2\n`, { agent: 'claude' });

    markExecuted(id, 2, { sessionId: 'sess-2', agent: 'codex', agentArgv: ['--model', 'gpt'] });

    const record = readVersions(id).versions.find((v) => v.n === 2);
    expect(record?.executed).toMatchObject({
      session_id: 'sess-2',
      agent: 'codex',
      agent_argv: ['--model', 'gpt'],
    });
    // Per version: v1 was never built, and marking v2 does not say otherwise.
    expect(readVersions(id).versions.find((v) => v.n === 1)?.executed).toBeNull();

    // The pointer the index row and the picker's green tone read is unchanged
    // by any of it, save for naming the agent that did the building.
    expect(readMeta(id)?.executed).toMatchObject({ version: 2, agent: 'codex' });
    expect(listPlans()[0]?.executed).toBe(2);
  });

  it('keeps a stored session when the second call brings none', () => {
    const id = seed();
    markExecuted(id, 1, { sessionId: 'sess-1', agent: 'claude', agentArgv: ['--model', 'opus'] });

    // A paste with no `--session-id` on it. Clearing a resumable session
    // because someone re-ran the command is a loss with no upside.
    markExecuted(id, 1, { agent: 'claude' });
    expect(readVersions(id).versions[0]?.executed).toMatchObject({
      session_id: 'sess-1',
      agent_argv: ['--model', 'opus'],
    });

    // One that brings a session id replaces it, launch line and all.
    markExecuted(id, 1, { sessionId: 'sess-9', agent: 'claude', agentArgv: [] });
    expect(readVersions(id).versions[0]?.executed).toMatchObject({
      session_id: 'sess-9',
      agent_argv: [],
    });
  });

  it('falls back to the agent that captured the version', () => {
    const id = seed();
    addVersion(id, `${SAMPLE_PLAN}\nrev 2\n`, { agent: 'claude' });
    markExecuted(id, 2, { sessionId: 'sess-2' });
    expect(readVersions(id).versions.find((v) => v.n === 2)?.executed?.agent).toBe('claude');
  });
});

describe('deleting', () => {
  it('destroys a plan and its index row, with no trash to land in', () => {
    const id = seed();
    purgePlan(id);
    expect(listPlans()).toHaveLength(0);
    expect(existsSync(paths.plan(id))).toBe(false);
  });

  it('removes named versions but never the latest', () => {
    const id = seed();
    for (let i = 2; i <= 4; i++) addVersion(id, `${SAMPLE_PLAN}\nrev ${i}\n`);

    expect(removeVersions(id, [2, 4])).toEqual([2]);
    expect(readVersions(id).versions.map((v) => v.n)).toEqual([1, 3, 4]);
    expect(existsSync(paths.versionFile(id, 2))).toBe(false);
    expect(existsSync(paths.versionFile(id, 4))).toBe(true);
  });
});

/**
 * What a plan opens as. A version with a predecessor opens against it — you
 * opened v4 because v4 is new, and what is new about it is the diff.
 */
describe('the version a review opens against', () => {
  it('is nothing for the first version, and the one before for the rest', () => {
    const id = seed();
    expect(previousStoredVersion(id, 1)).toBeNull();

    addVersion(id, `${SAMPLE_PLAN}\nrev 2\n`);
    addVersion(id, `${SAMPLE_PLAN}\nrev 3\n`);
    expect(previousStoredVersion(id, 2)).toBe(1);
    expect(previousStoredVersion(id, 3)).toBe(2);
  });

  it('skips a version that is on the books but has no text on disk', () => {
    const id = seed();
    for (let i = 2; i <= 4; i++) addVersion(id, `${SAMPLE_PLAN}\nrev ${i}\n`);
    rmSync(paths.versionFile(id, 3));
    // v4 opens against v2 rather than against a file that is not there — this
    // is the state `doctor` reports, and the review has to survive it.
    expect(previousStoredVersion(id, 4)).toBe(2);
  });
});

/**
 * The reviewer's own words, landing on the version they were written on.
 *
 * No v2 is minted: they rewrote a line of v1 and what they submitted is what
 * they meant, so there is no decision left for a new version to record.
 */
describe('editing a version in place', () => {
  it('rewrites the line and mints no version', () => {
    const id = seed();
    const result = rewriteVersion(id, 1, [{ line: 1, text: '# Guard the clock' }]);

    expect(latestVersion(id)).toBe(1);
    expect(readVersionText(id, 1)!.split('\n')[0]).toBe('# Guard the clock');
    expect(result.edits).toEqual([
      expect.objectContaining({
        line: 1,
        before: '# Guard the clock regression',
        after: '# Guard the clock',
      }),
    ]);
    // The record has to follow the file, or every later capture compares
    // against a hash of text nobody can read any more.
    const record = readVersions(id).versions.find((v) => v.n === 1)!;
    expect(record.sha256).toBe(result.sha256);
    expect(record.sha256).toBe(contentHash(readVersionText(id, 1)!));
  });

  it('drops a line typed back to what it already said', () => {
    const id = seed();
    const result = rewriteVersion(id, 1, [
      { line: 1, text: '# Guard the clock regression' },
      { line: 3, text: '## Background' },
    ]);

    expect(result.edits.map((e) => e.line)).toEqual([3]);
    expect(readVersions(id).versions[0]!.edits).toHaveLength(1);
  });

  it('appends across rounds rather than rewriting what it found', () => {
    const id = seed();
    rewriteVersion(id, 1, [{ line: 1, text: '# Guard it' }]);
    rewriteVersion(id, 1, [{ line: 1, text: '# Guard the R2 write path' }]);

    const edits = readVersions(id).versions[0]!.edits;
    expect(edits.map((e) => [e.before, e.after])).toEqual([
      ['# Guard the clock regression', '# Guard it'],
      ['# Guard it', '# Guard the R2 write path'],
    ]);
  });

  it('refuses a version that is not the latest', () => {
    const id = seed();
    addVersion(id, `${SAMPLE_PLAN}\nrev 2\n`);
    // Rewriting v1 rewrites the text v2 was built from.
    expect(() => rewriteVersion(id, 1, [{ line: 1, text: '# Nope' }])).toThrow('can be edited');
    expect(readVersionText(id, 1)!.split('\n')[0]).toBe('# Guard the clock regression');
  });
});

describe('corruption', () => {
  it('refuses to silently reset a file that fails its schema', () => {
    const id = seed();
    writeFileSync(paths.meta(id), '{"title": 42}');
    expect(() => readMeta(id)).toThrow(StoreCorruptionError);
  });

  it('refuses to silently reset a file that is not JSON at all', () => {
    const id = seed();
    writeFileSync(paths.versions(id), 'truncated mid-writ');
    expect(() => readVersions(id)).toThrow(StoreCorruptionError);
  });
});

/**
 * The user-level defaults, which live in the config beside `render`.
 *
 * They are an optional block with a default rather than a format bump, so the
 * first thing to hold is that a config written before they existed still reads.
 */
describe('the defaults block', () => {
  it('reads a config that predates it as two unset fields', () => {
    writeFileSync(paths.config(), '{"format_version": 1, "render": "plain"}\n');
    expect(readDefaults()).toEqual({ revise_command: null, execute_command: null });
    expect(readConfig().render).toBe('plain');
  });

  it('replaces one key and leaves the rest of the config alone', () => {
    writeConfig({ ...defaultConfig(), render: 'plain' });
    writeDefault('revise_command', 'codex exec --full-auto');
    const after = writeDefault('execute_command', 'claude --model opus');

    expect(after).toEqual({
      revise_command: 'codex exec --full-auto',
      execute_command: 'claude --model opus',
    });
    // Round-tripped through the file, not just returned.
    expect(readConfig()).toMatchObject({ render: 'plain', defaults: after });

    writeDefault('revise_command', 'codex exec');
    expect(readDefaults().execute_command).toBe('claude --model opus');
    expect(readConfig().render).toBe('plain');
  });

  it('stores a blank value as unset, whichever way it is blank', () => {
    writeDefault('revise_command', 'codex exec');
    expect(writeDefault('revise_command', '   ').revise_command).toBe(null);

    writeDefault('revise_command', 'codex exec');
    expect(writeDefault('revise_command', null).revise_command).toBe(null);
  });

  it('trims what it stores, so the stored line is the line it runs', () => {
    expect(writeDefault('revise_command', '  codex exec  ').revise_command).toBe('codex exec');
  });
});

/**
 * The hint rows, remembered across runs.
 *
 * A top-level flag rather than a row in the defaults block, and optional with a
 * default for the same reason that block is: a config written before it existed
 * still reads, with the bar on.
 */
describe('the hints flag', () => {
  it('reads a config that predates it as shown', () => {
    writeFileSync(paths.config(), '{"format_version": 1, "render": "plain"}\n');
    expect(readHints()).toBe(true);
    expect(readConfig().render).toBe('plain');
  });

  it('round-trips through the file, both ways', () => {
    writeHints(false);
    expect(readHints()).toBe(false);
    writeHints(true);
    expect(readHints()).toBe(true);
  });

  it('leaves the rest of the config alone', () => {
    writeConfig({ ...defaultConfig(), render: 'plain' });
    writeDefault('revise_command', 'codex exec');
    writeHints(false);

    expect(readConfig().render).toBe('plain');
    expect(readDefaults().revise_command).toBe('codex exec');
  });

  it('writes a config on the first toggle where there is none', () => {
    rmSync(paths.config(), { force: true });
    writeHints(false);
    expect(existsSync(paths.config())).toBe(true);
    expect(readHints()).toBe(false);
  });
});
