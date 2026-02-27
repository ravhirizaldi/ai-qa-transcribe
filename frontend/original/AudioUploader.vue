<script setup lang="ts">
import { ref } from "vue";
import { Upload, LoaderCircle } from "lucide-vue-next";

const props = withDefaults(
  defineProps<{
    isProcessing: boolean;
    multiple?: boolean;
    buttonLabel?: string;
  }>(),
  {
    multiple: false,
    buttonLabel: "Upload Audio",
  },
);

const emit = defineEmits<{
  (e: "file-selected", file: File): void;
  (e: "files-selected", files: File[]): void;
}>();

const errorMsg = ref("");

const validate = (file: File) => {
  if (!file.type.startsWith("audio/") && !file.name.endsWith(".m4a")) {
    return "Invalid file type. Please upload an audio file.";
  }

  if (file.size > 50 * 1024 * 1024) {
    return "File too large. Max size is 50MB.";
  }

  return "";
};

const handleInput = (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (!target.files?.length) return;

  const selectedFiles = Array.from(target.files);
  errorMsg.value = "";

  for (const selectedFile of selectedFiles) {
    const validationMessage = validate(selectedFile);
    if (validationMessage) {
      errorMsg.value = validationMessage;
      target.value = "";
      return;
    }
  }

  if (props.multiple) {
    emit("files-selected", selectedFiles);
  } else {
    const firstFile = selectedFiles[0];
    if (firstFile) emit("file-selected", firstFile);
  }

  target.value = "";
};
</script>

<template>
  <div class="relative flex flex-col items-end gap-2">
    <label class="cursor-pointer">
      <input
        type="file"
        accept="audio/*,.m4a"
        :multiple="props.multiple"
        @change="handleInput"
        :disabled="props.isProcessing"
        class="hidden"
      />
      <div
        class="upload-button"
        :class="{ 'opacity-60 cursor-not-allowed': props.isProcessing }"
      >
        <LoaderCircle v-if="props.isProcessing" class="w-4 h-4 animate-spin" />
        <Upload v-else class="w-4 h-4" />
        <span>{{ props.isProcessing ? "Processing..." : props.buttonLabel }}</span>
      </div>
    </label>

    <p v-if="!errorMsg" class="text-[11px] text-slate-400/90">
      mp3, wav, m4a up to 50MB
    </p>
    <p
      v-if="errorMsg"
      class="text-xs text-rose-300 bg-rose-400/15 border border-rose-300/30 px-2 py-1 rounded-md"
    >
      {{ errorMsg }}
    </p>
  </div>
</template>

<style scoped>
.upload-button {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.62rem 1rem;
  border-radius: 0.8rem;
  border: 1px solid rgba(34, 211, 238, 0.42);
  background: linear-gradient(
    180deg,
    rgba(34, 211, 238, 0.95),
    rgba(8, 145, 178, 0.95)
  );
  color: #082f49;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    filter 0.18s ease;
  box-shadow: 0 14px 24px rgba(6, 182, 212, 0.25);
}

.upload-button:hover {
  transform: translateY(-1px);
  filter: brightness(1.05);
  box-shadow: 0 18px 28px rgba(6, 182, 212, 0.3);
}

.upload-button:active {
  transform: translateY(0);
}
</style>
