<script setup lang="ts">
/**
 * The loop, drawn rather than typed.
 *
 * It replaces an ASCII sequence diagram, which said the right thing in the
 * wrong voice: grey monospace pipes at the top of the page that a reader has to
 * decode before the page begins. The shape is what matters here — two sides, a
 * hand-off in each direction, and a turn that ends rather than waits — so the
 * two sides get columns of their own, the hand-offs get the yellow, and the
 * commands stay in the mono the terminal prints them in.
 *
 * One rail down the middle on a wide screen, one down the left on a phone: the
 * order of the steps is the argument, and it survives the column collapsing.
 */

interface Step {
  side: 'agent' | 'you';
  command: string;
  detail: string[];
  /** The hand-off that follows this step, drawn on the rail beneath it. */
  handoff?: string;
}

const steps: Step[] = [
  {
    side: 'agent',
    command: 'planx capture --stdin --title "…"',
    detail: ['writes v2.md, prints the id and version', 'says “open planx <id> v2”, then stops'],
    handoff: 'turn over — nothing waits, nothing polls',
  },
  {
    side: 'you',
    command: 'planx <id> v2',
    detail: [
      'opens as the diff against v1',
      'select lines · feedback · lock · rewrite',
      's submits everything at once',
    ],
    handoff: 'prints /planx revise <id> — paste it back',
  },
  {
    side: 'agent',
    command: 'planx revise <id>',
    detail: [
      'every comment, quoted against its lines',
      'the locked blocks it must reproduce',
      'revises, captures v3, stops again',
    ],
  },
];
</script>

<template>
  <div class="pnx-loop">
    <div class="pnx-loop-heads" aria-hidden="true">
      <span>agent</span>
      <span>you</span>
    </div>

    <ol class="pnx-loop-steps">
      <li v-for="(step, i) in steps" :key="i" :class="step.side">
        <div class="pnx-loop-card">
          <p class="pnx-loop-who">{{ step.side }}</p>
          <p class="pnx-loop-cmd">{{ step.command }}</p>
          <ul>
            <li v-for="line in step.detail" :key="line">{{ line }}</li>
          </ul>
        </div>
        <p v-if="step.handoff" class="pnx-loop-hand">{{ step.handoff }}</p>
      </li>
    </ol>

    <p class="pnx-loop-again">and round again, until you press <b>a</b></p>
  </div>
</template>
