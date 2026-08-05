<script setup lang="ts">
/**
 * The terminal itself: a grid of characters, a keyboard, and a row of keys you
 * can tap instead.
 *
 * The frame is measured rather than assumed — one glyph is rendered off-screen,
 * its width divides the column, and the result is how many characters the
 * frame is drawn at. That is the same number the CLI reads from
 * `process.stdout.columns`, so a phone gets a narrow planx rather than a
 * desktop planx with a scrollbar.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Line } from '../sim/text.js';

const props = withDefaults(
  defineProps<{
    lines: Line[];
    label: string;
    /** A note is open: the keyboard goes to the input, not to the frame. */
    typing?: boolean;
    cols?: number;
  }>(),
  { typing: false, cols: 80 },
);

const emit = defineEmits<{ key: [token: string]; 'update:cols': [cols: number] }>();

const term = ref<HTMLElement | null>(null);
const screen = ref<HTMLElement | null>(null);
const ruler = ref<HTMLElement | null>(null);
const keyboard = ref<HTMLInputElement | null>(null);
const focused = ref(false);

/** Narrow enough to still be a frame, wide enough for a gutter and some text. */
const MIN_COLS = 48;

function measure(): void {
  const box = screen.value;
  const glyph = ruler.value;
  if (!box || !glyph) return;
  const charWidth = glyph.getBoundingClientRect().width / 20;
  const width = box.clientWidth;
  if (!charWidth || !width) return;
  const next = Math.max(MIN_COLS, Math.floor(width / charWidth));
  if (next !== props.cols) emit('update:cols', next);
}

/** The keys the frame consumes, so the page does not scroll under it. */
const SWALLOWED = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'Escape',
  'Backspace',
  ' ',
  'PageUp',
  'PageDown',
]);

function tokenFromEvent(event: KeyboardEvent): string | null {
  if (event.ctrlKey && /^[a-z]$/i.test(event.key)) return `ctrl+${event.key.toLowerCase()}`;
  if (event.metaKey || event.altKey || event.ctrlKey) return null;
  switch (event.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Enter':
      return 'enter';
    case 'Escape':
      return 'escape';
    case 'Backspace':
      return 'backspace';
    case ' ':
      return 'space';
    case 'PageUp':
      return 'pageup';
    case 'PageDown':
      return 'pagedown';
    default:
      return event.key.length === 1 ? event.key : null;
  }
}

function send(token: string): void {
  emit('key', token);
  restoreFocus();
}

function onKeydown(event: KeyboardEvent): void {
  // Tab keeps moving focus: a demo that traps the keyboard is a demo somebody
  // using a keyboard cannot leave.
  if (event.key === 'Tab') return;
  const token = tokenFromEvent(event);
  if (token === null) return;
  if (SWALLOWED.has(event.key) || event.key.length === 1) event.preventDefault();
  emit('key', token);
}

/**
 * Typing on a phone.
 *
 * A virtual keyboard reports almost nothing useful through `keydown`, so while
 * a note is open the focus moves to an input and whatever lands in it is
 * replayed. Enter, escape and backspace still arrive as keys, where they are
 * the same tokens the CLI sees.
 */
function onInput(event: Event): void {
  const el = event.target as HTMLInputElement;
  const typed = el.value;
  el.value = '';
  if (typed) emit('key', `text:${typed}`);
}

function onTypingKeydown(event: KeyboardEvent): void {
  if (event.key === 'Tab') return;
  const token = tokenFromEvent(event);
  if (token === null) return;
  // Printable characters are left to the input event, so a keyboard that
  // reports both does not type everything twice.
  if (token.length === 1 || token === 'space') return;
  event.preventDefault();
  emit('key', token);
}

function restoreFocus(): void {
  if (!focused.value) return;
  nextTick(() => {
    if (props.typing) keyboard.value?.focus({ preventScroll: true });
    else term.value?.focus({ preventScroll: true });
  });
}

watch(
  () => props.typing,
  () => restoreFocus(),
);

let observer: ResizeObserver | null = null;

onMounted(() => {
  measure();
  observer = new ResizeObserver(() => measure());
  if (screen.value) observer.observe(screen.value);
  // Web fonts land after the first paint and take the cell width with them.
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  fonts?.ready?.then(() => measure());
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div class="pnx-stage">
    <div
      ref="term"
      class="pnx-term"
      :class="{ 'is-focused': focused }"
      tabindex="0"
      role="application"
      :aria-label="props.label"
      @keydown="onKeydown"
      @focus="focused = true"
      @blur="focused = false"
    >
      <div ref="screen" class="pnx-screen">
        <span ref="ruler" class="pnx-ruler" aria-hidden="true">00000000000000000000</span>
        <div v-for="(line, i) in props.lines" :key="i" class="pnx-line">
          <span v-for="(piece, j) in line" :key="j" :class="piece.c">{{ piece.t }}</span>
        </div>
      </div>
      <p v-if="!focused" class="pnx-term-hint">click to use your keyboard, or tap the keys below</p>
    </div>

    <div class="pnx-keys" role="group" aria-label="keys">
      <slot name="keys" :send="send" />
    </div>

    <label v-show="props.typing" class="pnx-typing">
      <span
        >Typing — <b>enter</b> saves, <b>esc</b> discards. On a phone, tap here for the
        keyboard.</span
      >
      <input
        ref="keyboard"
        type="text"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        aria-label="type here"
        @input="onInput"
        @keydown="onTypingKeydown"
        @focus="focused = true"
        @blur="focused = false"
      />
    </label>
  </div>
</template>
