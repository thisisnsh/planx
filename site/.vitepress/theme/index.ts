import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import './style.css';
import './sim.css';
import PlanxCapture from './components/PlanxCapture.vue';
import PlanxLoop from './components/PlanxLoop.vue';
import PlanxPicker from './components/PlanxPicker.vue';
import PlanxSim from './components/PlanxSim.vue';

/**
 * The demos are global components, so a page embeds one with a tag and a
 * scenario name and nothing else. Every explanation on this site sits beside
 * the thing it explains, running.
 */
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('PlanxSim', PlanxSim);
    app.component('PlanxPicker', PlanxPicker);
    app.component('PlanxCapture', PlanxCapture);
    app.component('PlanxLoop', PlanxLoop);
  },
} satisfies Theme;
