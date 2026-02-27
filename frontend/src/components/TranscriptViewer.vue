<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import WaveSurfer from "wavesurfer.js";
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
  isMaximized?: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle-maximize"): void;
}>();

const waveformContainer = ref<HTMLElement | null>(null);
const chatContainer = ref<HTMLElement | null>(null);
const wavesurfer = ref<WaveSurfer | null>(null);
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const activeSegmentId = ref<number | null>(null);

const initWaveSurfer = () => {
  if (!waveformContainer.value || !props.file) return;

  if (wavesurfer.value) {
    wavesurfer.value.destroy();
  }

  wavesurfer.value = WaveSurfer.create({
    container: waveformContainer.value,
    waveColor: "#64748b",
    progressColor: "#22d3ee",
    cursorColor: "#22d3ee",
    barWidth: 2,
    barGap: 3,
    height: 72,
    normalize: true,
  });

  const audioUrl = URL.createObjectURL(props.file);
  wavesurfer.value.load(audioUrl);

  wavesurfer.value.on("ready", () => {
    duration.value = wavesurfer.value?.getDuration() || 0;
  });

  wavesurfer.value.on("timeupdate", (time) => {
    currentTime.value = time;
    updateActiveSegment(time);
  });

  wavesurfer.value.on("finish", () => {
    isPlaying.value = false;
  });
};

const togglePlay = () => {
  if (!wavesurfer.value) return;
  isPlaying.value = !isPlaying.value;
  wavesurfer.value.playPause();
};

const updateActiveSegment = (time: number) => {
  const segment = props.segments.find((seg) => time >= seg.start && time <= seg.end);
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

const jumpToSegment = (start: number) => {
  if (wavesurfer.value) {
    wavesurfer.value.setTime(start);
    wavesurfer.value.play();
    isPlaying.value = true;
  }
};

const isWordActive = (start: number, end: number) => {
  return currentTime.value >= start && currentTime.value <= end;
};

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

onMounted(() => {
  initWaveSurfer();
});

watch(
  () => props.file,
  () => {
    initWaveSurfer();
  },
);

onUnmounted(() => {
  if (wavesurfer.value) {
    wavesurfer.value.destroy();
  }
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
          <div ref="waveformContainer" class="h-16"></div>
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

          <div class="mt-2 flex items-center justify-end gap-2">
            <span
              v-if="seg.sentiment"
              class="w-2 h-2 rounded-full"
              :class="{
                'bg-emerald-400': seg.sentiment === 'positive',
                'bg-slate-400': seg.sentiment === 'neutral',
                'bg-rose-400': seg.sentiment === 'negative',
              }"
            ></span>
            <span class="text-[10px] uppercase tracking-[0.12em] opacity-65">
              {{ seg.sentiment || "unlabeled" }}
            </span>
          </div>
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
