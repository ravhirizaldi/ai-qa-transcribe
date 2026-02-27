<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getGlobalSettings, updateGlobalSettings } from "../services/backendApi";

const elevenlabsApiKey = ref("");
const xaiApiKey = ref("");
const xaiModel = ref("grok-4-1-fast-non-reasoning");

const hasElevenlabs = ref(false);
const hasXai = ref(false);

const isSavingGlobal = ref(false);
const message = ref("");

const load = async () => {
  message.value = "";

  const global = await getGlobalSettings();
  hasElevenlabs.value = global.hasElevenlabsApiKey;
  hasXai.value = global.hasXaiApiKey;
  xaiModel.value = global.xaiModel;
};

const saveGlobalSettings = async () => {
  isSavingGlobal.value = true;
  message.value = "";

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
    message.value = "Global provider settings saved.";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Failed to save global settings";
  } finally {
    isSavingGlobal.value = false;
  }
};

onMounted(async () => {
  await load();
});
</script>

<template>
  <section class="max-w-3xl rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-6">
    <p class="text-xs uppercase tracking-[0.22em] text-cyan-100/70">Global Settings</p>
    <h2 class="text-2xl text-white font-semibold mt-1">Provider Keys (All Projects)</h2>

    <div class="grid grid-cols-1 gap-3 mt-5">
      <label class="label">ElevenLabs API Key</label>
      <input
        v-model="elevenlabsApiKey"
        type="password"
        placeholder="Paste to set/update (leave blank to keep current)"
        class="input"
      />
      <p class="text-xs text-slate-400">Saved: {{ hasElevenlabs ? "Yes" : "No" }}</p>

      <label class="label mt-3">xAI API Key</label>
      <input
        v-model="xaiApiKey"
        type="password"
        placeholder="Paste to set/update (leave blank to keep current)"
        class="input"
      />
      <p class="text-xs text-slate-400">Saved: {{ hasXai ? "Yes" : "No" }}</p>

      <label class="label mt-3">xAI Model</label>
      <input v-model="xaiModel" type="text" class="input" />

      <button @click="saveGlobalSettings" :disabled="isSavingGlobal" class="btn-primary mt-2">
        {{ isSavingGlobal ? "Saving..." : "Save Global Settings" }}
      </button>
    </div>
  </section>

  <p v-if="message" class="text-xs text-cyan-200 mt-4">{{ message }}</p>
</template>

<style scoped>
.label {
  color: #cbd5e1;
  font-size: 0.82rem;
}

.input {
  width: 100%;
  border-radius: 0.6rem;
  border: 1px solid rgba(100, 116, 139, 0.55);
  background: rgba(15, 23, 42, 0.6);
  color: #e2e8f0;
  padding: 0.55rem 0.7rem;
}

.btn-primary {
  padding: 0.55rem 0.75rem;
  border-radius: 0.6rem;
  font-size: 0.82rem;
  font-weight: 700;
  color: #082f49;
  background: linear-gradient(180deg, rgba(34, 211, 238, 0.95), rgba(8, 145, 178, 0.95));
}
</style>
