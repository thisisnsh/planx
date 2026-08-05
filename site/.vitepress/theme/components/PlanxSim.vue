<script setup lang="ts">
/**
 * The review, running in the page.
 *
 * Every key is the key the CLI binds, drawn through the same row model — so
 * what a reader learns here is what their terminal will do. Nothing is written
 * anywhere: `s` prints the hand-off it would have printed, and the markdown the
 * agent would receive is shown underneath.
 */
import { computed, ref, shallowRef, watch } from 'vue';
import { createState, frame, hintsFor, layout, press, type SimState } from '../sim/engine.js';
import { scenario, type Task } from '../sim/scenarios.js';
import PlanxScreen from './PlanxScreen.vue';

const props = withDefaults(
  defineProps<{
    /** A name from sim/scenarios.ts. */
    scenario: string;
    /** Rows of plan on screen. The frame adds its own chrome around them. */
    rows?: number;
    /** Show the try-this checklist beside the frame. */
    tasks?: boolean;
  }>(),
  { rows: 15, tasks: true },
);

const spec = scenario(props.scenario);
const state = shallowRef<SimState>(createState(spec));
/** Bumped on every keypress, because the state is mutated in place. */
const tick = ref(0);
const cols = ref(80);

/**
 * A phone gets fewer rows, not smaller ones.
 *
 * The frame is already as narrow as the column, so a plan drawn at its desktop
 * height would be a screen and a half of terminal before the keys under it are
 * reachable — and the keys are how you drive it without a keyboard.
 */
const bodyRows = computed(() => (cols.value < 60 ? Math.min(props.rows, 11) : props.rows));

function refresh(): void {
  layout(state.value, cols.value, bodyRows.value);
  tick.value++;
}

watch(bodyRows, refresh, { immediate: true });

function onKey(token: string): void {
  press(state.value, token);
  refresh();
}

const lines = computed(() => {
  tick.value;
  return frame(state.value);
});

const isTyping = computed(() => {
  tick.value;
  const kind = state.value.mode.kind;
  return kind === 'editing' || kind === 'note' || kind === 'line';
});

const handoff = computed(() => {
  tick.value;
  return state.value.mode.kind === 'done' ? state.value.handoff : null;
});

const tasks = computed<Array<Task & { done: boolean }>>(() => {
  tick.value;
  return spec.tasks.map((task) => ({ ...task, done: state.value.did.has(task.id) }));
});

/**
 * The hint bar, as buttons.
 *
 * The frame prints the same keys along its bottom edge; these are those keys,
 * tappable, which is the whole of the mobile story — there is no second control
 * scheme to learn and nothing that only works with a keyboard.
 */
const chips = computed(() => {
  tick.value;
  const out: Array<{ key: string; label: string; token: string }> = [];
  if (!isTyping.value && state.value.mode.kind !== 'done') {
    out.push({ key: '↑', label: 'up', token: 'up' }, { key: '↓', label: 'down', token: 'down' });
  }
  for (const [key, what] of hintsFor(state.value)) {
    if (key === '←→') {
      out.push(
        { key: '←', label: 'older', token: 'left' },
        { key: '→', label: 'newer', token: 'right' },
      );
      continue;
    }
    out.push({ key, label: what, token: token(key) });
  }
  return out;
});

function token(key: string): string {
  if (key === 'esc') return 'escape';
  if (key === 'any key') return 'escape';
  return key;
}
</script>

<template>
  <div class="pnx-demo">
    <p v-if="spec.lede" class="pnx-demo-lede">{{ spec.lede }}</p>

    <div class="pnx-demo-body" :class="{ 'has-tasks': props.tasks && spec.tasks.length }">
      <PlanxScreen
        v-model:cols="cols"
        :lines="lines"
        :typing="isTyping"
        :label="`planx review — ${props.scenario} demo`"
        @key="onKey"
      >
        <template #keys="{ send }">
          <button
            v-for="chip in chips"
            :key="chip.key + chip.label"
            type="button"
            class="pnx-key"
            @click="send(chip.token)"
          >
            <b>{{ chip.key }}</b
            ><span>{{ chip.label }}</span>
          </button>
        </template>
      </PlanxScreen>

      <aside v-if="props.tasks && spec.tasks.length" class="pnx-tasks">
        <h4>Try it</h4>
        <ul>
          <li v-for="task in tasks" :key="task.id" :class="{ done: task.done }">
            <span class="pnx-tick" aria-hidden="true">{{ task.done ? '✓' : '·' }}</span>
            <span>{{ task.label }}</span>
          </li>
        </ul>
      </aside>
    </div>

    <div v-if="handoff" class="pnx-handoff">
      <h4>What your agent receives</h4>
      <pre>{{ handoff }}</pre>
    </div>
  </div>
</template>
