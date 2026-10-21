import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { stepCardClip } from './step-card-clip.ts';
import './step-cards.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.directive('step-card-clip', stepCardClip);
  },
} satisfies Theme;
