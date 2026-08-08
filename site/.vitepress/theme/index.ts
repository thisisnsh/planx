import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import './style.css';
import './features.css';
import FeatureTerminal from './components/FeatureTerminal.vue';
import PlanxLoop from './components/PlanxLoop.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('FeatureTerminal', FeatureTerminal);
    app.component('PlanxLoop', PlanxLoop);
  },
} satisfies Theme;
