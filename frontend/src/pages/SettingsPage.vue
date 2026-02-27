<script setup lang="ts">
import { onMounted, ref } from "vue";
import { toast } from "vue-sonner";
import { getGlobalSettings, updateGlobalSettings } from "../services/backendApi";

const elevenlabsApiKey = ref("");
const xaiApiKey = ref("");
const xaiModel = ref("grok-4-1-fast-non-reasoning");

const hasElevenlabs = ref(false);
const hasXai = ref(false);

const isSavingGlobal = ref(false);

const load = async () => {
  try {
    const global = await getGlobalSettings();
    hasElevenlabs.value = global.hasElevenlabsApiKey;
    hasXai.value = global.hasXaiApiKey;
    xaiModel.value = global.xaiModel;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to load global settings");
  }
};

const saveGlobalSettings = async () => {
  isSavingGlobal.value = true;

  try {
    const result = await updateGlobalSettings({
      elevenlabsApiKey: elevenlabsApiKey.value,
      xaiApiKey: xaiApiKey.value,
      xaiModel: xaiModel.value,
    });

    hasElevenlabs.value = result.hasElevenlabsApiKey;
    hasXai.value = result.hasXaiApiKey;
    xaiModel.value = result.xaiModel;
    elevenlabsApiKey.value = "";
    xaiApiKey.value = "";
    toast.success("Global provider settings saved");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to save global settings");
  } finally {
    isSavingGlobal.value = false;
  }
};

onMounted(async () => {
  await load();
});
</script>

<template>
  <section class="max-w-5xl rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-4">
    <p class="text-xs uppercase tracking-[0.22em] text-cyan-100/70">Global Settings</p>
    <h2 class="text-xl text-white font-semibold mt-1">Provider Keys (All Projects)</h2>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
      <div class="field-card">
        <label class="label">ElevenLabs API Key</label>
        <input
          v-model="elevenlabsApiKey"
          type="password"
          placeholder="Paste to set/update"
          class="input"
        />
        <p class="meta">Saved: {{ hasElevenlabs ? "Yes" : "No" }}</p>
      </div>

      <div class="field-card">
        <label class="label">xAI API Key</label>
        <input
          v-model="xaiApiKey"
          type="password"
          placeholder="Paste to set/update"
          class="input"
        />
        <p class="meta">Saved: {{ hasXai ? "Yes" : "No" }}</p>
      </div>

      <div class="field-card lg:col-span-2">
        <label class="label">xAI Model</label>
        <div class="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input v-model="xaiModel" type="text" class="input grow" />
          <button @click="saveGlobalSettings" :disabled="isSavingGlobal" class="btn-primary">
            {{ isSavingGlobal ? "Saving..." : "Save" }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.label {
  color: #cbd5e1;
  font-size: 0.78rem;
}

.field-card {
  border: 1px solid rgba(100, 116, 139, 0.35);
  border-radius: 0.7rem;
  background: rgba(2, 6, 23, 0.28);
  padding: 0.65rem;
}

.meta {
  color: #94a3b8;
  font-size: 0.72rem;
  margin-top: 0.35rem;
}

.input {
  width: 100%;
  border-radius: 0.6rem;
  border: 1px solid rgba(100, 116, 139, 0.55);
  background: rgba(15, 23, 42, 0.6);
  color: #e2e8f0;
  padding: 0.45rem 0.65rem;
  font-size: 0.82rem;
}

.btn-primary {
  padding: 0.46rem 0.75rem;
  border-radius: 0.6rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: #082f49;
  background: linear-gradient(180deg, rgba(34, 211, 238, 0.95), rgba(8, 145, 178, 0.95));
}
</style>
