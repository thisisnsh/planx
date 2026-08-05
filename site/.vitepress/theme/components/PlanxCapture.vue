<script setup lang="ts">
/**
 * What happens when an agent writes over a locked block.
 *
 * The point of a lock is that it is not advice, so this is the one part of
 * planx a reader cannot try from the review frame: it happens on the agent's
 * side, in `planx capture`. Walk it here instead — the write is refused, the
 * agent has to come back and ask, and the unlock it is then granted burns after
 * exactly one capture.
 */
import { computed, ref } from 'vue';

type Step = 'idle' | 'rejected' | 'unlocked' | 'kept';

const step = ref<Step>('idle');

const choices = computed<Array<{ label: string; to: Step; tone?: 'ghost' }>>(() => {
  switch (step.value) {
    case 'idle':
      return [{ label: 'Agent rewrites the locked rollout section', to: 'rejected' }];
    case 'rejected':
      return [
        { label: 'It asks you, you agree — it unlocks L1', to: 'unlocked' },
        { label: 'It keeps the block instead', to: 'kept', tone: 'ghost' },
      ];
    default:
      return [{ label: 'Start over', to: 'idle', tone: 'ghost' }];
  }
});
</script>

<template>
  <div class="pnx-capture">
    <ol class="pnx-capture-steps">
      <li :class="{ now: step === 'idle' }">1 · the agent captures</li>
      <li :class="{ now: step === 'rejected' }">2 · the write is refused</li>
      <li :class="{ now: step === 'unlocked' || step === 'kept' }">
        3 · it asks, or it keeps the block
      </li>
    </ol>

    <pre
      v-if="step === 'idle'"
      class="pnx-capture-out"
    ><span class="dim">$</span> planx capture --plan-id guard-clock-a3f9 --parent v3 --stdin &lt; plan.md

<span class="dim">The agent has rewritten the rollout section. Lock L1 covers it.</span></pre>

    <pre
      v-else-if="step === 'rejected'"
      class="pnx-capture-out"
    ><span class="red">✗ planx: locked block L1 ("## Rollout") was modified — version rejected.</span>

  <span class="red">- Deploy behind the `ff_clock_guard` flag, 10% then 50% then 100% over three days.</span>
  <span class="green">+ Deploy directly to 100%; the flag adds no value here.</span>

  This block is locked. Nothing was written.
  If you did not mean to touch it, use a <span class="sig">[[planx:keep L1]]</span> marker instead.
  If you did, explain the change to the user first. Only once they agree:
      <span class="sig">planx unlock guard-clock-a3f9 L1 --reason "..."</span>
  Then re-run capture.</pre>

    <pre
      v-else-if="step === 'unlocked'"
      class="pnx-capture-out"
    ><span class="dim">$</span> planx unlock guard-clock-a3f9 L1 --reason "staged rollout dropped; the guard ships off by default"
<span class="green">✓ L1 open for one capture.</span> The reason is on the record — <span class="sig">planx locks guard-clock-a3f9</span> shows it.

<span class="dim">$</span> planx capture --plan-id guard-clock-a3f9 --parent v3 --stdin &lt; plan.md
<span class="green">✓ guard-clock-a3f9 v4 captured.</span> <span class="dim">The grant is spent. L1 re-armed on what was just written.</span></pre>

    <pre
      v-else
      class="pnx-capture-out"
    ><span class="dim">$</span> planx capture --plan-id guard-clock-a3f9 --parent v3 --splice --stdin &lt; plan.md
<span class="green">✓ guard-clock-a3f9 v4 captured.</span>

<span class="dim">The plan it wrote carried the marker rather than the text:</span>
  <span class="sig">[[planx:keep L1]]</span>
<span class="dim">`--splice` expanded it back to the locked lines, byte for byte.</span></pre>

    <div class="pnx-capture-keys">
      <button
        v-for="choice in choices"
        :key="choice.label"
        type="button"
        class="pnx-key wide"
        :class="{ ghost: choice.tone === 'ghost' }"
        @click="step = choice.to"
      >
        {{ choice.label }}
      </button>
    </div>
  </div>
</template>
