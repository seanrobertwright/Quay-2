import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import Layout from './Layout.vue';
import { stepCardClip } from './step-card-clip.ts';
import './step-cards.css';

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.directive('step-card-clip', stepCardClip);
  },
} satisfies Theme;
