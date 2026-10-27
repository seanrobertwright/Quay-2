<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';
import { useData } from 'vitepress';
import FactoryHero from './FactoryHero.vue';

const { Layout } = DefaultTheme;
const { frontmatter } = useData();
</script>

<template>
  <Layout>
    <template #home-hero-before>
      <FactoryHero v-if="frontmatter.factoryHero" :hero="frontmatter.factoryHero" />
    </template>
  </Layout>
</template>
