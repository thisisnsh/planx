import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import './style.css';
import './features.css';
import LandingPage from './components/LandingPage.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('LandingPage', LandingPage);
  },
} satisfies Theme;
