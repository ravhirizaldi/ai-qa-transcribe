<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from "vue";
import {
  Play,
  Pause,
  Clock3,
  AudioLines,
  Maximize2,
  Minimize2,
} from "lucide-vue-next";

const props = defineProps<{
  transcript: string;
  segments: any[];
  file: File | null;
  audioUrl?: string | null;
  isMaximized?: boolean;
  showResize?: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle-maximize"): void;
}>();

const waveformContainer = ref<HTMLElement | null>(null);
const audioEl = ref<HTMLAudioElement | null>(null);
const chatContainer = ref<HTMLElement | null>(null);
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const activeSegmentId = ref<number | null>(null);
const isWaveReady = ref(false);
const resolvedAudioUrl = ref("");
let localFileUrl: string | null = null;
const WAVE_BAR_COUNT = 120;
const isDev = import.meta.env.DEV;
const debugAudio = (...args: unknown[]) => {
  if (!isDev) return;
  console.log(...args);
};

const resolveAudioUrl = () => {
  if (localFileUrl) {
    URL.revokeObjectURL(localFileUrl);
    localFileUrl = null;
  }
  if (props.file) {
    localFileUrl = URL.createObjectURL(props.file);
    resolvedAudioUrl.value = localFileUrl;
    return;
  }
  resolvedAudioUrl.value = props.audioUrl || "";
};

const initWaveSurfer = () => {
  resolveAudioUrl();
  debugAudio("[audio][player] init", {
    hasContainer: Boolean(waveformContainer.value),
    hasFile: Boolean(props.file),
    hasAudioUrlProp: Boolean(props.audioUrl),
    sourceUrl: resolvedAudioUrl.value,
  });
  if (!audioEl.value) return;
  const sourceUrl = resolvedAudioUrl.value;
  if (!sourceUrl) return;

  isPlaying.value = false;
  currentTime.value = 0;
  duration.value = 0;
  isWaveReady.value = false;
  audioEl.value.src = sourceUrl;
  audioEl.value.load();
};

const togglePlay = () => {
  if (!audioEl.value || !isWaveReady.value) {
    isPlaying.value = false;
    return;
  }
  if (audioEl.value.paused) {
    void audioEl.value.play();
    isPlaying.value = true;
  } else {
    audioEl.value.pause();
    isPlaying.value = false;
  }
};

const updateActiveSegment = (time: number) => {
  const segment = props.segments.find(
    (seg) => time >= seg.start && time <= seg.end,
  );
  if (segment) {
    const idx = props.segments.indexOf(segment);
    if (activeSegmentId.value !== idx) {
      activeSegmentId.value = idx;
      scrollToSegment(idx);
    }
  }
};

const scrollToSegment = (idx: number) => {
  if (!chatContainer.value) return;
  const el = document.getElementById(`segment-${idx}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
};

const seekAndPlay = (seconds: number) => {
  const maxDuration = duration.value || seconds;
  const target = Math.max(0, Math.min(maxDuration, seconds));

  if (audioEl.value && isWaveReady.value) {
    audioEl.value.currentTime = target;
    void audioEl.value.play();
    isPlaying.value = true;
  }

  currentTime.value = target;
  updateActiveSegment(target);
};

const onWaveformClick = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  const el = waveformContainer.value;
  if (!el) return;
  const totalDuration = duration.value || 0;
  if (!totalDuration) return;

  const rect = el.getBoundingClientRect();
  if (!rect.width) return;

  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const target = ratio * totalDuration;
  seekAndPlay(target);
};

const onAudioLoadedMetadata = () => {
  if (!audioEl.value) return;
  duration.value = Number.isFinite(audioEl.value.duration) ? audioEl.value.duration : 0;
  isWaveReady.value = duration.value > 0;
  debugAudio("[audio][player] loadedmetadata", { duration: duration.value });
};

const onAudioTimeUpdate = () => {
  if (!audioEl.value) return;
  currentTime.value = audioEl.value.currentTime;
  updateActiveSegment(currentTime.value);
};

const onAudioPlay = () => {
  isPlaying.value = true;
};

const onAudioPause = () => {
  isPlaying.value = false;
};

const onAudioEnded = () => {
  isPlaying.value = false;
};

const onAudioError = () => {
  isWaveReady.value = false;
  const mediaError = audioEl.value?.error;
  if (!isDev) return;
  console.error("[audio][player] error", {
    sourceUrl: resolvedAudioUrl.value,
    code: mediaError?.code,
    message: mediaError?.message,
  });
};

const jumpToSegment = (start: number) => {
  seekAndPlay(start);
};

const isWordActive = (start: number, end: number) => {
  return currentTime.value >= start && currentTime.value <= end;
};

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const deterministicNoise = (idx: number) => {
  const seed = Math.sin((idx + 1) * 12.9898) * 43758.5453;
  return seed - Math.floor(seed);
};

const waveformBars = computed(() => {
  const total = duration.value;
  if (!total) return [];

  const windowSize = total / WAVE_BAR_COUNT;
  return Array.from({ length: WAVE_BAR_COUNT }, (_, idx) => {
    const start = idx * windowSize;
    const end = start + windowSize;

    let activity = 0;
    for (const seg of props.segments) {
      const segStart = Number(seg.start || 0);
      const segEnd = Number(seg.end || segStart);
      const overlap = Math.max(0, Math.min(end, segEnd) - Math.max(start, segStart));
      if (overlap > 0) {
        activity += overlap / windowSize;
      }
    }

    const speaking = Math.max(0, Math.min(1, activity));
    const base = 0.18;
    const variance = 0.28 * deterministicNoise(idx);
    const speechBoost = 0.5 * speaking;
    const height = Math.max(0.08, Math.min(0.98, base + variance + speechBoost));
    return { idx, height };
  });
});

const playedRatio = computed(() =>
  duration.value ? Math.max(0, Math.min(1, currentTime.value / duration.value)) : 0,
);

onMounted(() => {
  initWaveSurfer();
});

watch(
  () => [props.file, props.audioUrl],
  () => {
    initWaveSurfer();
  },
);

onUnmounted(() => {
  if (audioEl.value) {
    audioEl.value.pause();
    audioEl.value.src = "";
    audioEl.value.load();
  }
  if (localFileUrl) {
    URL.revokeObjectURL(localFileUrl);
    localFileUrl = null;
  }
});

defineExpose({
  seekTo: (seconds: number) => seekAndPlay(seconds),
});
</script>

<template>
  <div class="transcript-panel h-full flex flex-col overflow-hidden">
    <div class="player-shell flex-shrink-0">
      <div class="flex items-center gap-3 justify-between mb-3">
        <div class="flex items-center gap-2 text-cyan-100">
          <AudioLines class="w-4 h-4" />
          <span class="text-xs uppercase tracking-[0.2em]">Playback</span>
        </div>

        <div class="flex items-center gap-3">
          <div class="text-xs text-slate-300/90">
            {{ segments.length }} segments
          </div>
          <button
            v-if="showResize !== false"
            @click="emit('toggle-maximize')"
            class="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-cyan-300 transition-colors"
            :title="isMaximized ? 'Minimize' : 'Maximize'"
          >
            <Minimize2 v-if="isMaximized" class="w-4 h-4" />
            <Maximize2 v-else class="w-4 h-4" />
          </button>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button
          class="play-button"
          @click="togglePlay"
          aria-label="Play or pause transcript audio"
        >
          <Pause v-if="isPlaying" fill="currentColor" class="w-5 h-5" />
          <Play v-else fill="currentColor" class="w-5 h-5" />
        </button>

        <div class="flex-1">
          <audio
            ref="audioEl"
            class="hidden"
            preload="auto"
            @loadedmetadata="onAudioLoadedMetadata"
            @timeupdate="onAudioTimeUpdate"
            @play="onAudioPlay"
            @pause="onAudioPause"
            @ended="onAudioEnded"
            @error="onAudioError"
          />
          <div
            v-show="!isWaveReady"
            class="h-16 flex items-center justify-center text-cyan-200/50 text-xs gap-2"
          >
            <div
              class="w-3 h-3 rounded-full border-2 border-cyan-400/30 border-t-cyan-400 animate-spin"
            ></div>
            Loading waveform...
          </div>
          <div
            v-show="isWaveReady"
            ref="waveformContainer"
            class="h-16 relative cursor-pointer rounded-lg overflow-hidden bg-slate-900/65 border border-slate-700/50 px-2"
            @click="onWaveformClick"
          >
            <div class="absolute inset-0 flex items-center gap-[2px]">
              <div
                v-for="bar in waveformBars"
                :key="bar.idx"
                class="wave-bar"
                :class="{
                  'wave-bar-played': bar.idx / WAVE_BAR_COUNT <= playedRatio,
                }"
                :style="{ height: `${Math.round(bar.height * 100)}%` }"
              ></div>
            </div>
            <div
              class="absolute inset-y-0 wave-cursor"
              :style="{ left: `${playedRatio * 100}%` }"
            >
              <div class="h-full bg-cyan-300"></div>
            </div>
          </div>
        </div>
      </div>

      <div
        class="flex items-center gap-1.5 mt-2 text-xs text-slate-300/80 font-mono"
      >
        <Clock3 class="w-3.5 h-3.5" />
        <span>{{ formatTime(currentTime) }}</span>
        <span>/</span>
        <span>{{ formatTime(duration) }}</span>
      </div>
    </div>

    <div
      ref="chatContainer"
      class="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4"
    >
      <div
        v-for="(seg, idx) in segments"
        :key="idx"
        :id="`segment-${idx}`"
        class="flex w-full segment-enter"
        :class="{
          'justify-end':
            seg.role === 'Customer' ||
            (!seg.role && seg.speakerId === 'speaker_1'),
          'justify-start':
            seg.role === 'CS' || (!seg.role && seg.speakerId === 'speaker_0'),
        }"
        @click="jumpToSegment(seg.start)"
      >
        <div
          class="message-card"
          :class="{
            'message-agent':
              seg.role === 'CS' || (!seg.role && seg.speakerId === 'speaker_0'),
            'message-customer':
              seg.role === 'Customer' ||
              (!seg.role && seg.speakerId === 'speaker_1'),
            'message-active': activeSegmentId === idx,
          }"
        >
          <div class="flex items-center justify-between gap-3 mb-1.5">
            <div
              class="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-80"
            >
              {{
                seg.role === "CS"
                  ? "CS Agent"
                  : seg.role === "Customer"
                    ? "Customer"
                    : seg.speakerId === "speaker_0"
                      ? "Speaker 1"
                      : "Speaker 2"
              }}
            </div>
            <div class="text-[10px] font-mono opacity-70">
              {{ formatTime(seg.start) }}
            </div>
          </div>

          <p class="text-sm leading-relaxed">
            <template v-if="seg.words && seg.words.length > 0">
              <span
                v-for="(word, wIdx) in seg.words"
                :key="wIdx"
                class="word-token"
                :class="{
                  'word-token-active': isWordActive(word.start, word.end),
                }"
              >
                {{ word.text }}
              </span>
            </template>
            <template v-else>
              {{ seg.cleaned_text || seg.text }}
            </template>
          </p>

        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.transcript-panel {
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: linear-gradient(
    180deg,
    rgba(15, 23, 42, 0.85),
    rgba(2, 6, 23, 0.94)
  );
}

.player-shell {
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  background: linear-gradient(
    180deg,
    rgba(15, 23, 42, 0.8),
    rgba(15, 23, 42, 0.5)
  );
  padding: 1rem 1.25rem;
}

.play-button {
  width: 2.7rem;
  height: 2.7rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: #082f49;
  background: linear-gradient(
    180deg,
    rgba(34, 211, 238, 0.96),
    rgba(6, 182, 212, 0.9)
  );
  box-shadow: 0 12px 20px rgba(6, 182, 212, 0.25);
  transition:
    transform 0.18s ease,
    filter 0.18s ease;
}

.play-button:hover {
  transform: translateY(-1px);
  filter: brightness(1.07);
}

.native-audio {
  margin-top: 0.55rem;
  width: 100%;
  height: 2rem;
}

.wave-bar {
  flex: 1;
  align-self: center;
  border-radius: 999px;
  background: rgba(100, 116, 139, 0.5);
  transition: background-color 0.1s ease;
}

.wave-bar-played {
  background: rgba(34, 211, 238, 0.9);
}

.wave-cursor {
  width: 2px;
  transform: translateX(-1px);
}

.message-card {
  max-width: 76%;
  border-radius: 0.95rem;
  padding: 0.85rem 0.95rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  cursor: pointer;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    border-color 0.16s ease;
}

.message-card:hover {
  transform: translateY(-1px);
}

.message-agent {
  background: rgba(30, 41, 59, 0.9);
  color: #e2e8f0;
}

.message-customer {
  background: rgba(6, 182, 212, 0.15);
  border-color: rgba(34, 211, 238, 0.35);
  color: #ecfeff;
}

.message-active {
  border-color: rgba(34, 211, 238, 0.7);
  box-shadow:
    0 0 0 2px rgba(34, 211, 238, 0.22),
    0 14px 24px rgba(8, 47, 73, 0.35);
}

.word-token {
  border-radius: 0.22rem;
  padding: 0.03rem 0.11rem;
  transition:
    background-color 0.1s ease,
    color 0.1s ease;
}

.word-token-active {
  background: rgba(34, 211, 238, 0.88);
  color: #082f49;
  font-weight: 700;
}

.segment-enter {
  animation: segmentIn 0.22s ease-out;
}

@keyframes segmentIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
