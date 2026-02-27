<script setup lang="ts">
import { computed } from "vue";
import {
  ShieldAlert,
  ShieldCheck,
  ClipboardList,
  CheckCircle2,
  XCircle,
  Maximize2,
  Minimize2,
} from "lucide-vue-next";

interface QAScorecard {
  summary: string;
  evaluation_table: {
    area: string;
    evidence_timestamp: string;
    note: string;
    score: number;
    max_score?: number;
    parameter?: string;
    description?: string;
  }[];
  red_flags: string | null;
  routing: string;
}

const props = defineProps<{
  analysis: QAScorecard;
  isMaximized?: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle-maximize"): void;
}>();

const hasRisk = computed(() => Boolean(props.analysis.red_flags));

const totalScore = computed(() => {
  return props.analysis.evaluation_table.reduce(
    (acc, curr) => acc + (curr.score || 0),
    0,
  );
});

// Calculate Stats
const stats = computed(() => {
  let nceTotal = 0;
  let ncePassed = 0;
  let ceTotal = 0;
  let cePassed = 0;

  props.analysis.evaluation_table.forEach((row) => {
    const isPassed = row.score === (row.max_score || 0);
    const param = (row.parameter || "").toUpperCase();

    if (param === "NCE") {
      nceTotal++;
      if (isPassed) ncePassed++;
    } else if (param === "CE") {
      ceTotal++;
      if (isPassed) cePassed++;
    }
  });

  return { nceTotal, ncePassed, ceTotal, cePassed };
});

const isClockFormat = (value: string) =>
  /^\d{2}:\d{2}(?::\d{2})?(?:\s*-\s*\d{2}:\d{2}(?::\d{2})?)?$/.test(
    value.trim(),
  );

const secToClock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0)
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
};

const prettyTimestamp = (raw: string): string => {
  const value = (raw || "").trim();
  if (!value) return "N/A";
  if (isClockFormat(value)) return value;

  const numbers = value.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) return value;
  if (numbers.length >= 2) {
    const start = Number(numbers[0]);
    const end = Number(numbers[1]);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      return `${secToClock(start)} - ${secToClock(end)}`;
    }
  }

  const single = Number(numbers[0]);
  if (Number.isFinite(single)) return secToClock(single);
  return value;
};
</script>

<template>
  <div class="analysis-panel h-full overflow-y-auto p-5 sm:p-6 relative">
    <!-- Resize Button positioned absolutely at top right -->
    <button
      @click="emit('toggle-maximize')"
      class="absolute top-5 right-5 p-2 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-cyan-300 transition-colors z-10"
      :title="isMaximized ? 'Minimize' : 'Maximize'"
    >
      <Minimize2 v-if="isMaximized" class="w-5 h-5" />
      <Maximize2 v-else class="w-5 h-5" />
    </button>

    <div class="flex flex-col gap-5 mb-5">
      <div class="pr-10">
        <!-- Padding right to avoid overlap with resize button -->
        <p class="text-xs uppercase tracking-[0.22em] text-cyan-100/70">
          Quality Review
        </p>
        <h2 class="text-xl font-semibold text-white">QA Scorecard</h2>
      </div>

      <div class="flex items-center gap-6">
        <!-- Stats Detail -->
        <div class="flex gap-4 text-xs font-mono text-slate-300">
          <div class="flex flex-col items-center">
            <span class="uppercase text-[10px] tracking-widest text-slate-500"
              >NCE</span
            >
            <span
              :class="
                stats.ncePassed === stats.nceTotal
                  ? 'text-emerald-400'
                  : 'text-slate-200'
              "
            >
              {{ stats.ncePassed }}/{{ stats.nceTotal }}
            </span>
          </div>
          <div class="flex flex-col items-center">
            <span class="uppercase text-[10px] tracking-widest text-slate-500"
              >CE</span
            >
            <span
              :class="
                stats.cePassed === stats.ceTotal
                  ? 'text-emerald-400'
                  : 'text-amber-400'
              "
            >
              {{ stats.cePassed }}/{{ stats.ceTotal }}
            </span>
          </div>
        </div>

        <div class="text-right border-l border-slate-700/50 pl-6">
          <p class="text-[10px] uppercase tracking-widest text-emerald-300">
            Total Score
          </p>
          <p class="text-2xl font-bold text-emerald-400 font-mono">
            {{ totalScore
            }}<span class="text-sm text-emerald-400/50">/100</span>
          </p>
        </div>

        <div v-if="hasRisk" class="status-pill status-risk ml-2">
          <ShieldAlert class="w-3.5 h-3.5" />
          <span>High Risk</span>
        </div>
        <div v-else class="status-pill status-safe ml-2">
          <ShieldCheck class="w-3.5 h-3.5" />
          <span>Good Call</span>
        </div>
      </div>
    </div>

    <section class="info-card mb-5">
      <div class="card-heading">
        <ClipboardList class="w-4 h-4" />
        <h3>Call Summary</h3>
      </div>
      <p class="text-sm text-slate-200 leading-relaxed mt-2">
        {{ analysis.summary }}
      </p>
    </section>

    <section class="info-card mb-5">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p class="text-slate-400 text-xs uppercase tracking-[0.14em]">
            Routing
          </p>
          <p class="text-slate-100 font-medium mt-1">
            {{ analysis.routing || "N/A" }}
          </p>
        </div>
        <div v-if="analysis.red_flags">
          <p class="text-rose-300 text-xs uppercase tracking-[0.14em]">
            Red Flags
          </p>
          <p class="text-rose-100 mt-1">{{ analysis.red_flags }}</p>
        </div>
      </div>
    </section>

    <section class="mb-6">
      <h3 class="section-title">Evaluation Matrix</h3>
      <div class="table-wrap mt-2">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-700/70 bg-slate-900/85">
              <th
                class="px-3 py-2.5 text-center font-semibold text-slate-200 w-10"
              >
                #
              </th>
              <th class="px-3 py-2.5 text-left font-semibold text-slate-200">
                Area
              </th>

              <!-- Conditional Criteria Column -->
              <th
                v-if="isMaximized"
                class="px-3 py-2.5 text-left font-semibold text-slate-200 w-1/3"
              >
                Criteria
              </th>

              <th
                class="px-3 py-2.5 text-center font-semibold text-slate-200 w-24"
              >
                Score
              </th>
              <th class="px-3 py-2.5 text-left font-semibold text-slate-200">
                Evidence
              </th>
              <th class="px-3 py-2.5 text-left font-semibold text-slate-200">
                Note
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, idx) in analysis.evaluation_table"
              :key="idx"
              class="border-b border-slate-800/80 hover:bg-slate-800/35 transition-colors"
            >
              <td class="px-3 py-2.5 text-center w-10">
                <div
                  v-if="row.score === (row.max_score || 0)"
                  class="inline-flex items-center justify-center text-emerald-400"
                  title="Passed"
                >
                  <CheckCircle2 class="w-4 h-4" />
                </div>
                <div
                  v-else
                  class="inline-flex items-center justify-center text-rose-400"
                  title="Failed"
                >
                  <XCircle class="w-4 h-4" />
                </div>
              </td>
              <td class="px-3 py-2.5 font-medium text-slate-200 w-1/4">
                {{ row.area }}
                <span
                  class="block text-[10px] text-slate-500 uppercase tracking-wider font-mono mt-0.5"
                >
                  {{ row.parameter }}
                </span>
              </td>

              <!-- Conditional Description Cell -->
              <td
                v-if="isMaximized"
                class="px-3 py-2.5 text-slate-400 text-xs italic leading-relaxed"
              >
                {{ row.description || "No description available" }}
              </td>

              <td class="px-3 py-2.5 font-mono text-center w-24">
                <span
                  :class="
                    row.score === (row.max_score || 0)
                      ? 'text-emerald-300'
                      : 'text-rose-300 font-bold'
                  "
                >
                  {{ row.score }}
                </span>
                <span class="text-slate-500 text-xs">/{{ row.max_score }}</span>
              </td>
              <td
                class="px-3 py-2.5 font-mono text-cyan-300 whitespace-nowrap w-1/6"
              >
                {{ prettyTimestamp(row.evidence_timestamp) }}
              </td>
              <td class="px-3 py-2.5 text-slate-300">{{ row.note }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.analysis-panel {
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: linear-gradient(
    180deg,
    rgba(15, 23, 42, 0.86),
    rgba(2, 6, 23, 0.95)
  );
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border-radius: 999px;
  padding: 0.42rem 0.72rem;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 700;
}

.status-risk {
  border: 1px solid rgba(251, 113, 133, 0.42);
  background: rgba(251, 113, 133, 0.18);
  color: #fecdd3;
}

.status-safe {
  border: 1px solid rgba(52, 211, 153, 0.42);
  background: rgba(52, 211, 153, 0.16);
  color: #bbf7d0;
}

.info-card {
  border-radius: 0.85rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(15, 23, 42, 0.55);
  padding: 0.95rem;
}

.card-heading {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: #a5f3fc;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.section-title {
  color: #e2e8f0;
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.17em;
  font-weight: 700;
}

.section-with-icon {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.table-wrap {
  border-radius: 0.8rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  overflow-x: auto;
}
</style>
