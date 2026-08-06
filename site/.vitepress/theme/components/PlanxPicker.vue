<script setup lang="ts">
/**
 * Bare `planx` — the picker, running in the page.
 *
 * The same frame the review wears, the same keys, and the one destructive key
 * planx has: `d` names what it is about to delete in full, and asks.
 */
import { computed, ref, shallowRef, watch } from 'vue';
import {
  createPicker,
  demoPlans,
  pickerFrame,
  pickerHints,
  pickerPress,
  type PickerState,
} from '../sim/picker.js';
import PlanxScreen from './PlanxScreen.vue';

const props = withDefaults(defineProps<{ rows?: number }>(), { rows: 8 });

const state = shallowRef<PickerState>(createPicker(demoPlans()));
const tick = ref(0);
const cols = ref(80);

const rows = computed(() => (cols.value < 60 ? Math.min(props.rows, 6) : props.rows));

watch(
  cols,
  () => {
    state.value.cols = cols.value;
    tick.value++;
  },
  { immediate: true },
);

function onKey(token: string): void {
  pickerPress(state.value, token);
  tick.value++;
}

const lines = computed(() => {
  tick.value;
  return pickerFrame(state.value, rows.value);
});

const chips = computed(() => {
  tick.value;
  const out: Array<{ key: string; label: string; token: string }> = [];
  for (const [key, what] of pickerHints(state.value)) {
    if (key === '↑↓') {
      out.push({ key: '↑', label: 'up', token: 'up' }, { key: '↓', label: 'down', token: 'down' });
      continue;
    }
    out.push({
      key,
      label: what,
      token:
        key === 'esc'
          ? 'escape'
          : key === '←'
            ? 'left'
            : key === '→'
              ? 'right'
              : key.startsWith('^')
                ? `ctrl+${key.slice(1)}`
                : key,
    });
  }
  return out;
});
</script>

<template>
  <div class="pnx-demo">
    <p class="pnx-demo-lede">
      Bare <code>planx</code> with no arguments. Type to filter, <code>→</code> opens a plan's
      versions, <code>d</code> deletes the row you are pointing at.
    </p>
    <PlanxScreen v-model:cols="cols" :lines="lines" label="planx picker demo" @key="onKey">
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
  </div>
</template>
