<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { withBase } from 'vitepress';
import { VPButton } from 'vitepress/theme';

const props = defineProps<{
  hero: {
    name: string;
    text: string;
    tagline: string;
    video: string;
    poster: string;
    actions: { theme: 'brand' | 'alt'; text: string; link: string }[];
  };
}>();

const video = ref<HTMLVideoElement>();
const source = ref<string>();
const isPlaying = ref(false);
const isReady = ref(false);
const videoUnavailable = ref(false);
const playbackMessage = ref('');
let motionPreference: MediaQueryList | undefined;

async function playVideo() {
  playbackMessage.value = '';
  // Leave the source unset until playback is wanted, including for reduced motion.
  source.value = withBase(props.hero.video);
  await nextTick();
  if (!video.value) return;
  video.value.muted = true;
  try {
    await video.value.play();
  } catch {
    playbackMessage.value = 'The video did not start. Use Play video to try again.';
  }
}

function togglePlayback() {
  if (isPlaying.value) video.value?.pause();
  else void playVideo();
}

function respectMotionPreference(event: MediaQueryListEvent) {
  if (event.matches) video.value?.pause();
}

function showPoster() {
  videoUnavailable.value = true;
  isPlaying.value = false;
  playbackMessage.value = 'The background video is unavailable. A still image is shown instead.';
}

onMounted(() => {
  isReady.value = true;
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionPreference.addEventListener('change', respectMotionPreference);
  if (!motionPreference.matches) void playVideo();
});

onBeforeUnmount(() => {
  motionPreference?.removeEventListener('change', respectMotionPreference);
});
</script>

<template>
  <section class="factory-hero" aria-labelledby="factory-hero-title">
    <img
      class="factory-hero__media"
      :src="withBase(hero.poster)"
      alt=""
      width="1920"
      height="1080"
      fetchpriority="high"
    />
    <video
      v-show="!videoUnavailable"
      id="factory-hero-video"
      ref="video"
      class="factory-hero__media"
      :src="source"
      :poster="withBase(hero.poster)"
      width="1920"
      height="1080"
      muted
      loop
      playsinline
      preload="none"
      aria-hidden="true"
      tabindex="-1"
      @play="isPlaying = true"
      @pause="isPlaying = false"
      @error="showPoster"
    />
    <div class="factory-hero__shade" aria-hidden="true" />

    <div class="factory-hero__inner">
      <div class="factory-hero__copy">
        <p class="factory-hero__name">{{ hero.name }}</p>
        <h1 id="factory-hero-title">{{ hero.text }}</h1>
        <p class="factory-hero__tagline">{{ hero.tagline }}</p>
        <div class="factory-hero__actions">
          <VPButton
            v-for="action in hero.actions"
            :key="action.link"
            :theme="action.theme"
            :text="action.text"
            :href="action.link"
            size="big"
          />
        </div>
      </div>
    </div>

    <button
      v-if="isReady"
      class="factory-hero__playback"
      type="button"
      aria-controls="factory-hero-video"
      :aria-label="videoUnavailable ? 'Background video unavailable' : isPlaying ? 'Pause background video' : 'Play background video'"
      :disabled="videoUnavailable"
      @click="togglePlayback"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path v-if="isPlaying" d="M4 3h3v10H4zm5 0h3v10H9z" />
        <path v-else d="M4 2.5v11L13 8z" />
      </svg>
      {{ videoUnavailable ? 'Video unavailable' : isPlaying ? 'Pause video' : 'Play video' }}
    </button>
    <p class="visually-hidden" role="status">{{ playbackMessage }}</p>
  </section>
</template>

<style scoped>
.factory-hero {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  margin-bottom: 64px;
  background: #080e13;
  color: #f5f8fb;
  --vp-button-brand-bg: #8de7ef;
  --vp-button-brand-border: #8de7ef;
  --vp-button-brand-text: #081e24;
  --vp-button-brand-hover-bg: #b5f4f8;
  --vp-button-brand-hover-border: #b5f4f8;
  --vp-button-brand-hover-text: #081e24;
  --vp-button-brand-active-bg: #6dd3de;
  --vp-button-brand-active-text: #081e24;
  --vp-button-alt-bg: #17242f;
  --vp-button-alt-border: #526571;
  --vp-button-alt-text: #f5f8fb;
  --vp-button-alt-hover-bg: #243744;
  --vp-button-alt-hover-border: #8de7ef;
  --vp-button-alt-hover-text: #fff;
  --vp-button-alt-active-bg: #17242f;
  --vp-button-alt-active-text: #fff;
}

.factory-hero__media,
.factory-hero__shade {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.factory-hero__media {
  object-fit: cover;
  object-position: center;
}

.factory-hero__shade {
  background: linear-gradient(90deg, rgb(5 11 17 / 92%) 0%, rgb(5 11 17 / 78%) 30%, rgb(5 11 17 / 20%) 65%, transparent 100%);
}

.factory-hero__inner {
  position: relative;
  display: flex;
  align-items: center;
  max-width: 1280px;
  min-height: 660px;
  margin: 0 auto;
  padding: 80px 48px 100px;
}

.factory-hero__copy { max-width: 620px; }

.factory-hero__name {
  margin: 0 0 20px;
  color: #8de7ef;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.factory-hero h1 {
  margin: 0;
  font-size: clamp(36px, 4.2vw, 56px);
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: -0.035em;
  text-wrap: balance;
}

.factory-hero__tagline {
  max-width: 560px;
  margin: 24px 0 0;
  color: #d2e0e9;
  font-size: 19px;
  line-height: 1.6;
}

.factory-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}

.factory-hero__playback {
  position: absolute;
  right: 24px;
  bottom: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 16px;
  border: 1px solid #637985;
  border-radius: 24px;
  background: rgb(8 17 25 / 90%);
  color: #f5f8fb;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.factory-hero__playback:hover { background: #243744; }
.factory-hero__playback:disabled { cursor: default; }

.factory-hero :deep(a:focus-visible),
.factory-hero__playback:focus-visible {
  outline: 3px solid #b5f4f8;
  outline-offset: 4px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 767px) {
  .factory-hero { margin-bottom: 48px; }
  .factory-hero__inner {
    min-height: 640px;
    padding: 64px 24px 104px;
  }
  .factory-hero__media { object-position: 70% center; }
  .factory-hero__shade {
    background: linear-gradient(90deg, rgb(5 11 17 / 94%), rgb(5 11 17 / 64%));
  }
  .factory-hero__tagline { font-size: 17px; }
  .factory-hero__actions :deep(.VPButton) {
    padding-inline: 18px;
    font-size: 14px;
  }
}
</style>
