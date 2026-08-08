<script setup lang="ts">
/** The review loop: one hand-off at a time, readable in one or two columns. */

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
    command: '/planx <task>',
    detail: ['researches the work', 'captures a version and prints its ID'],
    handoff: 'the plan is ready for review',
  },
  {
    side: 'you',
    command: 'planx <id> v2',
    detail: [
      'opens as the diff against v1',
      'selects lines · adds feedback · edits text',
      's submits everything at once',
    ],
    handoff: 'choose revision or copy /planx revise <id>',
  },
  {
    side: 'agent',
    command: '/planx revise <id>',
    detail: ['reads each comment beside its exact lines', 'keeps direct edits', 'captures v3'],
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

    <p class="pnx-loop-again">and round again, until the plan is settled</p>
  </div>
</template>
