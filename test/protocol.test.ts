import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closingBlock, handOffLine, runInteractiveReview, type Ctx } from '../src/cli/commands.js';
import { capture, deriveTitle } from '../src/protocol/capture.js';
import { carriedOver, presentResume } from '../src/protocol/present.js';
import { buildAnnotation, submitFeedback } from '../src/protocol/submit.js';
import { blue, setColorEnabled, yellow } from '../src/render/ansi.js';
import { readVersionText } from '../src/store/plans.js';
import { normalizedLines } from '../src/store/text.js';
import { listFeedback } from '../src/store/feedback.js';
import { readDefaults, writeDefault, type DefaultKey } from '../src/store/defaults.js';
import { paths } from '../src/store/paths.js';
import { SAMPLE_PLAN, tempStore } from './helpers.js';

let store: ReturnType<typeof tempStore>;

beforeEach(() => {
  store = tempStore();
  setColorEnabled(false);
});
afterEach(() => {
  store.cleanup();
  setColorEnabled(null);
});

function seed() {
  return capture({ text: SAMPLE_PLAN, source: 'test' });
}

function comment(planId: string, version: number, from: number, to: number, body: string) {
  const doc = normalizedLines(readVersionText(planId, version)!);
  return buildAnnotation(doc, from, to, body, 'a1');
}

describe('capture', () => {
  it('creates a plan, derives the title from the H1, and writes v1', () => {
    const result = seed();
    expect(result).toMatchObject({ version: 1, created: true, isNewPlan: true });
    expect(result.title).toBe('Guard the clock regression');
    expect(readVersionText(result.planId, 1)).toContain('## Approach');
  });

  it('falls back to the first non-empty line when there is no H1', () => {
    expect(deriveTitle('\n\nJust some prose here.\nMore.\n')).toBe('Just some prose here.');
    expect(deriveTitle('   \n')).toBe('Untitled plan');
  });

  it('is a no-op for byte-identical content, so skills can call it defensively', () => {
    const first = seed();
    const again = capture({ planId: first.planId, text: SAMPLE_PLAN });
    expect(again).toMatchObject({ version: 1, created: false });
  });
});

describe('the review loop', () => {
  it('retires feedback when the next version lands, so the loop terminates', () => {
    const { planId } = seed();
    submitFeedback({
      planId,
      version: 1,
      annotations: [comment(planId, 1, 6, 6, 'Rework this.')],
    });

    const revised = capture({ planId, text: `${SAMPLE_PLAN}\n## Risks\nNone.\n`, parent: 'v1' });
    expect(revised.closedFeedback).toBe(1);
    expect(listFeedback(planId)[0]!.addressed_by).toBe(2);
    // Nothing is outstanding against the new version until someone reviews it.
    expect(listFeedback(planId).filter((f) => f.version === 2)).toHaveLength(0);
  });
});

describe('one feedback record per version', () => {
  it('replaces the record rather than appending a second one', () => {
    const { planId } = seed();
    submitFeedback({
      planId,
      version: 1,
      annotations: [comment(planId, 1, 6, 6, 'Rework this.')],
    });
    const first = listFeedback(planId)[0]!;

    submitFeedback({
      planId,
      version: 1,
      annotations: [comment(planId, 1, 6, 6, 'Rework this, properly.')],
    });

    const history = listFeedback(planId);
    expect(history).toHaveLength(1);
    expect(history[0]!.annotations[0]!.comment).toBe('Rework this, properly.');
    // The record's identity is the version's, so it survives being rewritten.
    expect(history[0]!.id).toBe(first.id);
    expect(readdirSync(paths.feedbackDir(planId))).toEqual(['v1.json']);
  });

  /**
   * Emptying a comment is how it is deleted, and the deletion lands on the next
   * submit — which under an append-only store it could not, because there was
   * no way to write "there is nothing here now".
   */
  it('lets an empty submit delete the last comment', () => {
    const { planId } = seed();
    submitFeedback({
      planId,
      version: 1,
      annotations: [comment(planId, 1, 6, 6, 'Rework this.')],
    });

    submitFeedback({ planId, version: 1, annotations: [] });

    expect(listFeedback(planId)[0]!.annotations).toEqual([]);
  });

  /**
   * Rewriting the record must not reopen it. A later version answered this
   * feedback, which stays true however the reviewer edits the words — and a
   * rewrite that dropped `addressed_by` would put closed feedback back on the
   * outstanding pile every time the version was submitted again.
   */
  it('keeps feedback closed when its record is rewritten', () => {
    const { planId } = seed();
    submitFeedback({
      planId,
      version: 1,
      annotations: [comment(planId, 1, 6, 6, 'Rework this.')],
    });
    capture({ planId, text: `${SAMPLE_PLAN}\n## Risks\nNone.\n`, parent: 'v1' });
    expect(listFeedback(planId)[0]!.addressed_by).toBe(2);

    submitFeedback({
      planId,
      version: 1,
      annotations: [comment(planId, 1, 6, 6, 'Rework this, properly.')],
    });

    expect(listFeedback(planId)[0]!.addressed_by).toBe(2);
  });

  /** A store an older planx wrote collapses on read, losing nothing. */
  it('merges a version left with several records by an older planx', () => {
    const { planId } = seed();
    const dir = paths.feedbackDir(planId);
    mkdirSync(dir, { recursive: true });
    const base = {
      format_version: 1,
      plan_id: planId,
      version: 1,
      general: '',
      addressed_by: null,
    };
    writeFileSync(
      join(dir, 'v1-01AAA.json'),
      JSON.stringify({
        ...base,
        id: '01AAA',
        created: '2026-01-01T00:00:00.000Z',
        general: 'name the flag',
        annotations: [comment(planId, 1, 6, 6, 'first pass')],
      }),
    );
    writeFileSync(
      join(dir, 'v1-01BBB.json'),
      JSON.stringify({
        ...base,
        id: '01BBB',
        created: '2026-01-02T00:00:00.000Z',
        annotations: [comment(planId, 1, 6, 6, 'second pass')],
      }),
    );

    const history = listFeedback(planId);
    expect(history).toHaveLength(1);
    // Same id, so the later submit's text replaces the earlier one rather than
    // doubling it — and the note survives a submit that did not carry one.
    expect(history[0]!.annotations.map((a) => a.comment)).toEqual(['second pass']);
    expect(history[0]!.general).toBe('name the flag');

    // …and the first write of the new shape takes the old files with it.
    submitFeedback({ planId, version: 1, annotations: [] });
    expect(readdirSync(dir)).toEqual(['v1.json']);
  });
});

describe('what the agent sees', () => {
  function resumeOf(planId: string, version: number) {
    const text = readVersionText(planId, version)!;
    const history = listFeedback(planId);
    return presentResume({
      planId,
      version,
      text,
      feedback: history.filter((f) => f.version === version),
      carried: carriedOver(history, version, text),
    });
  }

  it('quotes each annotation and ends with the exact next command', () => {
    const { planId } = seed();
    submitFeedback({
      planId,
      version: 1,
      annotations: [comment(planId, 1, 7, 8, 'Wrong layer. Guard belongs in the R2 write path.')],
      general: 'Direction is fine, but see the comment.',
    });

    const text = resumeOf(planId, 1);
    expect(text).toContain(`## planx — ${planId} v1`);
    expect(text).toContain('under "## Approach"');
    expect(text).toContain('> ## Approach');
    expect(text).toContain('**Feedback:** Wrong layer.');
    expect(text).toContain('#### General');
    expect(text).toContain(`planx capture --plan-id ${planId} --parent v1 --stdin`);
  });

  it('tells the agent to build it when the review asked for nothing', () => {
    const { planId } = seed();
    submitFeedback({ planId, version: 1, annotations: [] });

    const text = resumeOf(planId, 1);
    expect(text).toContain('Reviewed with nothing to change. Implement it as written.');
    expect(text).not.toContain('planx capture');
  });
});

/**
 * What the review's ending does to the store and to the terminal.
 *
 * The list hands back a command the reviewer may have rewritten, so this is
 * about running *that* rather than rebuilding one — and about the order, since
 * the feedback has to be on disk before anything is handed the terminal.
 */
describe('what the reviewer picked', () => {
  function ctx(out: string[], err: string[]): Ctx {
    return {
      args: { positionals: [], values: new Map(), bools: new Set(), unknown: [] },
      json: false,
      mode: 'plain',
      version: '9.9.9',
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    };
  }

  /** A review that ended on `action`, with whatever the reviewer left behind. */
  function ended(
    action: 'revise' | 'execute' | 'commands' | 'back',
    command: string | null,
    custom: DefaultKey | null = null,
  ) {
    return async () => ({
      action,
      command,
      custom,
      batches: [
        { version: 1, annotations: [], general: 'the whole thing reads well', touched: true },
      ],
      version: 1,
      edits: [],
      editedVersion: null,
    });
  }

  it('writes the feedback first, then runs the line the reviewer left', async () => {
    const { planId } = seed();
    const out: string[] = [];
    const err: string[] = [];
    // A binary that is not on PATH: what it was asked to run is still reported,
    // and the closing block lands after it.
    const line = 'planx-no-such-agent --model opus "/planx execute x v1"';

    const code = await runInteractiveReview(ctx(out, err), planId, null, 1, ended('execute', line));

    expect(out[0]).toContain(`Submitted no feedback on ${planId} v1.`);
    expect(out[1]).toBe(`Running  ${line}`);
    expect(listFeedback(planId)[0]?.general).toBe('the whole thing reads well');
    // Split rather than shelled: the first token is the binary planx tried.
    expect(err.join('\n')).toContain('planx-no-such-agent is not on your PATH');
    expect(out.join('\n')).toContain(`Reopen it in your terminal:  planx ${planId} v1`);
    expect(code).not.toBe(0);
  });

  it('prints the block instead when the reviewer only wanted the commands', async () => {
    const { planId } = seed();
    const out: string[] = [];

    const code = await runInteractiveReview(ctx(out, []), planId, null, 1, ended('commands', null));

    expect(out.join('\n')).not.toContain('Running');
    expect(out.join('\n')).toContain(`Revise this plan in your agent:  /planx revise ${planId}`);
    expect(code).toBe(0);
  });

  /**
   * Rewriting a custom row and running it is how a stored command gets fixed:
   * the next review opens on the command you settled on rather than on the one
   * you have now corrected twice.
   */
  describe('an edited custom row', () => {
    /** A binary that is not on PATH: the write happens before the spawn does. */
    const BIN = 'planx-no-such-agent';

    /** Run the review on `command` and hand back what the defaults became. */
    async function ran(
      action: 'revise' | 'execute',
      command: string,
      key: DefaultKey | null = null,
    ) {
      const { planId } = seed();
      await runInteractiveReview(ctx([], []), planId, null, 1, ended(action, command, key));
      return readDefaults();
    }

    it('stores the remainder once the appended prompt is off', async () => {
      writeDefault('revise_command', BIN);
      const after = await ran(
        'revise',
        `${BIN} --full-auto "/planx revise guard"`,
        'revise_command',
      );
      expect(after.revise_command).toBe(`${BIN} --full-auto`);
      // One key, and only one.
      expect(after.execute_command).toBe(null);
    });

    it('writes nothing when the reviewer changed nothing', async () => {
      writeDefault('execute_command', BIN);
      const after = await ran('execute', `${BIN} "/planx execute guard v1"`, 'execute_command');
      expect(after.execute_command).toBe(BIN);
    });

    /** Clearing a default is what `planx defaults` is for, not an emptied line. */
    it('writes nothing when what is left is blank', async () => {
      writeDefault('revise_command', BIN);
      const after = await ran('revise', '  "/planx revise guard"', 'revise_command');
      expect(after.revise_command).toBe(BIN);
    });

    it('leaves the defaults alone for a row planx built itself', async () => {
      writeDefault('revise_command', BIN);
      const after = await ran('revise', `${BIN} --resume 01J8 "/planx revise guard"`);
      expect(after.revise_command).toBe(BIN);
    });
  });
});

/**
 * The command the reviewer carries back out. Without one the round dead-ends
 * exactly where it is meant to continue, which is what used to happen after a
 * submit — so these are pinned verbatim.
 */
describe('the review hand-off', () => {
  it('says where every command runs, on the line that carries it', () => {
    setColorEnabled(false);
    expect(handOffLine('Reopen it in your terminal', 'planx guard-clock-a3f9 v3')).toBe(
      'Reopen it in your terminal:  planx guard-clock-a3f9 v3',
    );
    expect(handOffLine('Revise this plan in your agent', '/planx revise guard-clock-a3f9 v3')).toBe(
      'Revise this plan in your agent:  /planx revise guard-clock-a3f9 v3',
    );
  });

  it('opens on the way back in, whichever way the review ended', () => {
    setColorEnabled(false);
    for (const carried of [undefined, false, true]) {
      const block = closingBlock('guard-clock-a3f9', 4, carried);
      expect(block[0]).toBe('Reopen it in your terminal:  planx guard-clock-a3f9 v4');
      expect(block.at(-1)).toBe('');
    }
  });

  it('quitting carries nothing but the way back in', () => {
    setColorEnabled(false);
    expect(closingBlock('guard-clock-a3f9', 4)).toEqual([
      'Reopen it in your terminal:  planx guard-clock-a3f9 v4',
      '',
    ]);
  });

  // A submit that carried nothing is the reviewer saying the plan is fine, so
  // there is nothing to answer and one command is enough.
  it('offers execute alone when the submit carried nothing', () => {
    setColorEnabled(false);
    expect(closingBlock('guard-clock-a3f9', 3, false)).toEqual([
      'Reopen it in your terminal:  planx guard-clock-a3f9 v3',
      'Execute this plan in your agent:  /planx execute guard-clock-a3f9 v3',
      '',
    ]);
  });

  // The execute label carries no qualifier: revise is the line above it, which
  // is the order saying the feedback comes first.
  it('offers revise then execute when the submit carried feedback', () => {
    setColorEnabled(false);
    expect(closingBlock('guard-clock-a3f9', 3, true)).toEqual([
      'Reopen it in your terminal:  planx guard-clock-a3f9 v3',
      'Revise this plan in your agent:  /planx revise guard-clock-a3f9 v3',
      'Execute it in your agent:  /planx execute guard-clock-a3f9 v3',
      '',
    ]);
  });

  it('puts the clipboard status last', () => {
    setColorEnabled(false);
    expect(closingBlock('guard-clock-a3f9', 3, true, 'Copied to your clipboard.')).toEqual([
      'Reopen it in your terminal:  planx guard-clock-a3f9 v3',
      'Revise this plan in your agent:  /planx revise guard-clock-a3f9 v3',
      'Execute it in your agent:  /planx execute guard-clock-a3f9 v3',
      'Copied to your clipboard.',
      '',
    ]);
  });

  // Four adjacent lines read as one block, which is what they are.
  it('runs the entries together, with no blank line between them', () => {
    setColorEnabled(false);
    const block = closingBlock('guard-clock-a3f9', 3, true);
    expect(block.filter((line) => line === '')).toHaveLength(1);
    expect(block.slice(0, -1).every((line) => line !== '')).toBe(true);
  });

  /**
   * Colour is what tells the three apart at a glance: the way back is white,
   * and the two next steps carry one each.
   */
  it('paints the way back white, revise yellow and execute blue', () => {
    setColorEnabled(true);
    const [reopen, revise, execute] = closingBlock('guard-clock-a3f9', 3, true);
    // Grey label, white command: terminal commands remain easy to read.
    expect(reopen).toContain(`\x1b[22m  planx guard-clock-a3f9 v3`);
    expect(reopen).not.toContain(`\x1b[2mplanx guard-clock-a3f9 v3\x1b[22m`);
    // Truecolor, not a palette slot: planx has one yellow and one blue, and
    // they are the same wherever they are drawn.
    expect(revise).toContain(yellow('/planx revise guard-clock-a3f9 v3'));
    expect(execute).toContain(blue('/planx execute guard-clock-a3f9 v3'));
    expect(revise).toContain('\x1b[38;2;255;212;0m');
    // The labels are grey on every line, so the command is what stands out.
    for (const line of [reopen, revise, execute]) expect(line).toContain('\x1b[2m');
    setColorEnabled(false);
  });

  it('leaves the final clipboard status white', () => {
    setColorEnabled(true);
    const block = closingBlock('guard-clock-a3f9', 3, true, 'Copied to your clipboard.');
    expect(block.at(-2)).toBe('Copied to your clipboard.');
    setColorEnabled(false);
  });
});
