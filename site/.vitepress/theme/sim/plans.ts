/**
 * The plan every demo on this site is driven from.
 *
 * Three versions of one real-shaped plan, with the feedback that produced each
 * revision still on the version it was left on — which is what makes `←` and
 * `→` worth pressing, and what a first-time reader needs in order to see the
 * loop rather than an empty document.
 *
 * Anchors are looked up by their text rather than written as line numbers.
 * Editing a fixture then cannot silently move a comment onto the wrong
 * paragraph.
 */

import type { SimPlan } from './engine.js';
import { splitLines } from './diff.js';

const V1 = `# Guard the clock regression

## Context

The poller writes one snapshot per five-minute period.
Twice this month a node came back from a restart with a
clock behind its last write, and the snapshot for the
current period was overwritten with older data.

Nothing downstream noticed: the dashboard read the newer
row, the alerting read the older one, and the two
disagreed for nine hours.

## Approach

Extend the snapshot-regression guard in \`poller.ts\` to
also reject a cross-period backward jump.

- Compare the incoming timestamp to the last accepted one.
- Reject anything more than one period behind.
- Count the rejection against the node that sent it.

## Tests

- A node whose clock jumps back inside one period is
  rejected.
- A node whose clock jumps back across a period boundary
  is rejected.
- A late write that is still inside its own period lands
  as it does today.

## Rollout

Deploy behind the \`ff_clock_guard\` flag: 10%, then 50%,
then 100% over three days.

Watch the rejection counter — anything above 0.1% of
writes is a bug in the guard, not a fleet of bad clocks.
`;

const V2 = `# Guard the clock regression

## Context

The poller writes one snapshot per five-minute period.
Twice this month a node came back from a restart with a
clock behind its last write, and the snapshot for the
current period was overwritten with older data.

Nothing downstream noticed: the dashboard read the newer
row, the alerting read the older one, and the two
disagreed for nine hours.

## Approach

Reject the write at the R2 path, where every snapshot
already passes through one function, rather than in the
poller that happens to have produced it.

- Read the period key already on the object.
- Refuse a write whose period is older than the one stored.
- Count the refusal against the node that sent it.

The poller keeps its own guard. It is a different failure
— a node arguing with itself — and folding the two
together would make one alert mean two things.

## Tests

- A node whose clock jumps back inside one period is
  rejected.
- A node whose clock jumps back across a period boundary
  is rejected.
- A late write that is still inside its own period lands
  as it does today.
- Two nodes writing the same period concurrently keep the
  later arrival.

## Rollout

Deploy behind the \`ff_clock_guard\` flag: 10%, then 50%,
then 100% over three days.

Watch the rejection counter — anything above 0.1% of
writes is a bug in the guard, not a fleet of bad clocks.
`;

const V3 = `# Guard the clock regression

## Context

The poller writes one snapshot per five-minute period.
Twice this month a node came back from a restart with a
clock behind its last write, and the snapshot for the
current period was overwritten with older data.

Nothing downstream noticed: the dashboard read the newer
row, the alerting read the older one, and the two
disagreed for nine hours.

## Approach

Reject the write at the R2 path, where every snapshot
already passes through one function, rather than in the
poller that happens to have produced it.

- Read the period key already on the object.
- Refuse a write whose period is older than the one stored.
- Count the refusal against the node that sent it, with
  both periods.

The poller keeps its own guard. It is a different failure
— a node arguing with itself — and folding the two
together would make one alert mean two things.

## Tests

- A node whose clock jumps back inside one period is
  rejected.
- A node whose clock jumps back across a period boundary
  is rejected.
- A late write that is still inside its own period lands
  as it does today.
- Two nodes writing the same period concurrently keep the
  later arrival.
- A refused write leaves the stored object unchanged.

## Rollout

Deploy behind the \`ff_clock_guard\` flag: 10%, then 50%,
then 100% over three days.

Watch the rejection counter — anything above 0.1% of
writes is a bug in the guard, not a fleet of bad clocks.
`;

/** The 1-based line a piece of text sits on. */
export function lineOf(text: string, needle: string): number {
  const index = splitLines(text).findIndex((line) => line.includes(needle));
  if (index === -1) throw new Error(`planx demo: no line matching ${JSON.stringify(needle)}`);
  return index + 1;
}

export const VERSIONS = [V1, V2, V3];

/**
 * The plan as it stands after two rounds of review: the feedback that turned
 * the poller guard into an R2 guard still on v1, and one open question on v2.
 */
export function guardClock(options: { folded?: number[] } = {}): SimPlan {
  return {
    id: 'guard-clock-a3f9',
    title: 'Guard the clock regression',
    versions: VERSIONS,
    feedback: {
      1: [
        {
          id: 'a1',
          start: lineOf(V1, 'Extend the snapshot-regression guard'),
          end: lineOf(V1, 'also reject a cross-period backward jump.'),
          comment: 'Wrong layer. Every snapshot goes through the R2 write path — put it there.',
        },
        {
          id: 'a2',
          start: lineOf(V1, 'A late write that is still inside its own period'),
          end: lineOf(V1, 'A late write that is still inside its own period'),
          comment: 'Add the concurrent case: two nodes, same period, which one wins?',
        },
      ],
      2: [
        {
          id: 'a1',
          start: lineOf(V2, 'Count the refusal against the node that sent it.'),
          end: lineOf(V2, 'Count the refusal against the node that sent it.'),
          comment: 'Record both periods in the metric, not just the node — we will want the delta.',
        },
      ],
      3: [
        {
          id: 'a1',
          start: lineOf(V3, 'Reject the write at the R2 path'),
          end: lineOf(V3, 'poller that happens to have produced it.'),
          comment:
            'Say which function. There are two on that path and only one of them sees the period key.',
        },
        {
          id: 'a2',
          start: lineOf(V3, 'A refused write leaves the stored object'),
          end: lineOf(V3, 'A refused write leaves the stored object'),
          comment:
            'Assert on the etag rather than the bytes — reading the object back to compare it is the expensive way to say this.',
        },
      ],
    },
    notes: { 1: 'Good problem statement. The fix is in the wrong place.' },
    folded: options.folded,
  };
}
