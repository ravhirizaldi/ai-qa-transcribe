<script setup lang="ts">
import { onMounted, ref } from "vue";
import { toast } from "vue-sonner";
import { getGlobalSettings, updateGlobalSettings } from "../../services/backendApi";

const elevenlabsApiKey = ref("");
const xaiApiKey = ref("");
const xaiModel = ref("grok-4-1-fast-non-reasoning");

const hasElevenlabs = ref(false);
const hasXai = ref(false);
const isSaving = ref(false);

const load = async () => {
  try {
    const global = await getGlobalSettings();
    hasElevenlabs.value = global.hasElevenlabsApiKey;
    hasXai.value = global.hasXaiApiKey;
    xaiModel.value = global.xaiModel;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to load system settings");
  }
};

const save = async () => {
  isSaving.value = true;
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
    toast.success("System settings updated");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to save system settings");
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="panel">
    <p class="eyebrow">System</p>
    <h2 class="title">Provider Settings</h2>

    <div class="grid">
      <div class="field-card">
        <label class="label">ElevenLabs API Key</label>
        <input v-model="elevenlabsApiKey" type="password" class="input" placeholder="Paste to update" />
        <p class="meta">Saved: {{ hasElevenlabs ? "Yes" : "No" }}</p>
      </div>

      <div class="field-card">
        <label class="label">xAI API Key</label>
        <input v-model="xaiApiKey" type="password" class="input" placeholder="Paste to update" />
        <p class="meta">Saved: {{ hasXai ? "Yes" : "No" }}</p>
      </div>

      <div class="field-card wide">
        <label class="label">xAI Model</label>
        <div class="row">
          <input v-model="xaiModel" type="text" class="input grow" />
          <button @click="save" :disabled="isSaving" class="btn-primary">
            {{ isSaving ? "Saving..." : "Save" }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  max-width: 72rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 1rem;
  padding: 1rem;
  background: rgba(2, 6, 23, 0.35);
}
.eyebrow {
  color: #a5f3fc;
  font-size: 0.74rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.title {
  margin-top: 0.2rem;
  color: #f8fafc;
  font-size: 1.2rem;
  font-weight: 700;
}
.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
  margin-top: 0.8rem;
}
.field-card {
  border: 1px solid rgba(100, 116, 139, 0.35);
  border-radius: 0.75rem;
  background: rgba(15, 23, 42, 0.6);
  padding: 0.75rem;
}
.wide {
  grid-column: 1 / -1;
}
.label {
  color: #cbd5e1;
  font-size: 0.78rem;
}
.meta {
  margin-top: 0.4rem;
  color: #94a3b8;
  font-size: 0.72rem;
}
.input {
  width: 100%;
  margin-top: 0.35rem;
  border-radius: 0.6rem;
  border: 1px solid rgba(100, 116, 139, 0.55);
  background: rgba(15, 23, 42, 0.6);
  color: #e2e8f0;
  padding: 0.5rem 0.65rem;
  font-size: 0.82rem;
}
.row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.grow {
  flex: 1;
}
.btn-primary {
  border-radius: 0.6rem;
  padding: 0.46rem 0.8rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: #082f49;
  background: linear-gradient(180deg, rgba(34, 211, 238, 0.95), rgba(8, 145, 178, 0.95));
}
@media (min-width: 1024px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
