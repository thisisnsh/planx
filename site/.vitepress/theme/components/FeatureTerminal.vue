<script setup lang="ts">
import { computed } from 'vue';

type Example = 'feedback' | 'diff' | 'versions' | 'editing' | 'readability' | 'handoff';

const props = defineProps<{ example: Example }>();

const labels: Record<Example, string> = {
  feedback: 'Feedback attached to several selected lines of a plan',
  diff: 'Word-level changes between two plan versions',
  versions: 'A plan moving through three revisions',
  editing: 'A directly edited line and a note about the whole plan',
  readability: 'A collapsed section and a collapsed unchanged diff run',
  handoff: 'A review handed back for revision and then execution',
};

const label = computed(() => labels[props.example]);
</script>

<template>
  <figure class="pnx-terminal" :class="`is-${example}`">
    <figcaption>{{ label }}</figcaption>
    <div class="pnx-terminal-bar" aria-hidden="true">
      <span></span><span></span><span></span>
      <b>PlanX</b>
    </div>

    <pre
      v-if="example === 'feedback'"
      :aria-label="label"
    ><code><span class="pnx-term-dim"> 10   ## Rollout</span>
<span class="pnx-term-selected">▸11 │ Start at 10% of uploads.</span>
<span class="pnx-term-selected"> 12 │ Move to 50% after one hour.</span>
<span class="pnx-term-selected"> 13 │ Finish at 100% the same day.</span>
<span class="pnx-term-rail">    ├────────────────────────────────────────╮</span>
<span class="pnx-term-note">    │ Add the error-rate gate for each step. │</span>
<span class="pnx-term-rail">    ╰────────────────────────────────────────╯</span></code></pre>

    <pre
      v-else-if="example === 'diff'"
      :aria-label="label"
    ><code><span class="pnx-term-head">upload-limits-a3f9  v3 ← v2</span>
<span class="pnx-term-gap">⋯ 8 unchanged lines (space to expand)</span>
<span class="pnx-term-del">-24 Apply a <mark>global</mark> limit to every request.</span>
<span class="pnx-term-add">+24 Apply a <mark>per-user</mark> limit to every request.</span>
<span class="pnx-term-del">-25 Return 429 after <mark>100</mark> uploads.</span>
<span class="pnx-term-add">+25 Return 429 after <mark>20 uploads per minute</mark>.</span></code></pre>

    <pre
      v-else-if="example === 'versions'"
      :aria-label="label"
    ><code><span class="pnx-term-head">upload-limits-a3f9  revisions</span>
<span><b>v1</b>  captured              initial approach</span>
<span class="pnx-term-rail"> │</span>
<span><b>v2</b>  reviewed              rate limit moved per user</span>
<span class="pnx-term-rail"> │</span>
<span class="pnx-term-current"><b>v3</b>  settled               rollout gate added  ✓</span></code></pre>

    <pre
      v-else-if="example === 'editing'"
      :aria-label="label"
    ><code><span class="pnx-term-head">upload-limits-a3f9  v3</span>
<span class="pnx-term-dim"> 17   ## Limits</span>
<span class="pnx-term-edit">~18   Use a 20-upload per-minute limit.</span>
<span class="pnx-term-dim"> 19   Return a Retry-After header.</span>

<span class="pnx-term-note">NOTE  Keep the public API backwards compatible.</span></code></pre>

    <pre
      v-else-if="example === 'readability'"
      :aria-label="label"
    ><code><span class="pnx-term-head">upload-limits-a3f9  v3 ← v2</span>
<span>  1   # Add upload rate limits</span>
<span class="pnx-term-gap">  ⋯ 12 lines in Approach (space to expand)</span>
<span> 18   ## Rollout</span>
<span class="pnx-term-gap">  ⋯ 9 unchanged lines (space to expand)</span>
<span class="pnx-term-add">+28   Alert when rejections exceed 2%.</span></code></pre>

    <pre
      v-else
      :aria-label="label"
    ><code><span class="pnx-term-head">review → revise → execute</span>
<span class="pnx-term-note">1 feedback submitted on v2</span>
<span>$ /planx revise upload-limits-a3f9</span>
<span class="pnx-term-current">v3 reviewed with nothing to change</span>
<span>$ /planx execute upload-limits-a3f9 v3</span></code></pre>
  </figure>
</template>
