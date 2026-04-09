<script setup lang="ts">
import { ref } from "vue";
import { Upload, LoaderCircle } from "lucide-vue-next";

const props = withDefaults(
  defineProps<{
    isProcessing: boolean;
    disabled?: boolean;
    multiple?: boolean;
    buttonLabel?: string;
    disabledButtonLabel?: string;
    disabledMessage?: string;
  }>(),
  {
    disabled: false,
    multiple: false,
    buttonLabel: "Upload Audio",
    disabledButtonLabel: "Upload Unavailable",
    disabledMessage: "Upload is currently unavailable",
  },
);

const emit = defineEmits<{
  (e: "file-selected", file: File): void;
  (e: "files-selected", files: File[]): void;
}>();

const errorMsg = ref("");
const isDragging = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

const validate = (file: File) => {
  if (!file.type.startsWith("audio/") && !file.name.endsWith(".m4a")) {
    return "Invalid file type. Please upload an audio file.";
  }
  if (file.size > 50 * 1024 * 1024) {
    return "File too large. Max size is 50MB.";
  }
  return "";
};

const processFiles = (files: File[]) => {
  if (!files.length) return;
  errorMsg.value = "";

  for (const file of files) {
    const validationMessage = validate(file);
    if (validationMessage) {
      errorMsg.value = validationMessage;
      return;
    }
  }

  if (props.multiple) {
    emit("files-selected", files);
  } else {
    const firstFile = files[0];
    if (firstFile) emit("file-selected", firstFile);
  }
};

const handleInput = (e: Event) => {
  if (props.disabled) return;
  const target = e.target as HTMLInputElement;
  if (!target.files?.length) return;
  processFiles(Array.from(target.files));
  target.value = "";
};

const handleDrop = (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = false;
  if (props.disabled || props.isProcessing) return;
  const dtFiles = e.dataTransfer?.files;
  if (!dtFiles?.length) return;
  processFiles(Array.from(dtFiles));
};

const handleDragOver = (e: DragEvent) => {
  e.preventDefault();
  if (!props.disabled && !props.isProcessing) isDragging.value = true;
};

const handleDragLeave = () => {
  isDragging.value = false;
};

const triggerInput = () => {
  if (!props.disabled && !props.isProcessing) {
    fileInputRef.value?.click();
  }
};
</script>

<template>
  <div class="uploader-root">
    <div
      class="drop-zone"
      :class="{
        'drop-zone-dragging': isDragging,
        'drop-zone-disabled': props.isProcessing || props.disabled,
      }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <input
        ref="fileInputRef"
        type="file"
        accept="audio/*,.m4a"
        :multiple="props.multiple"
        @change="handleInput"
        :disabled="props.isProcessing || props.disabled"
        class="hidden"
      />
      <div class="drop-content">
        <LoaderCircle
          v-if="props.isProcessing"
          class="w-5 h-5 animate-spin drop-icon"
        />
        <Upload v-else class="w-5 h-5 drop-icon" />
        <p class="drop-label">
          {{
            props.isProcessing
              ? "Uploading..."
              : props.disabled
                ? props.disabledMessage
                : "Drag & drop audio files here"
          }}
        </p>
        <p v-if="!props.isProcessing && !props.disabled" class="drop-hint">
          mp3, wav, m4a — max 50MB each
        </p>
      </div>
      <button
        v-if="!props.isProcessing"
        class="upload-pick-btn"
        :class="{ 'upload-pick-btn-disabled': props.disabled }"
        type="button"
        :disabled="props.disabled"
        @click="triggerInput"
      >
        {{ props.disabled ? props.disabledButtonLabel : props.buttonLabel }}
      </button>
    </div>
    <p v-if="errorMsg" class="upload-error">
      {{ errorMsg }}
    </p>
  </div>
</template>

<style scoped>
.uploader-root {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.drop-zone {
  border: 1.5px dashed rgba(34, 211, 238, 0.4);
  border-radius: 0.85rem;
  background: rgba(8, 47, 73, 0.3);
  padding: 1rem 1.2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  transition:
    border-color 0.18s,
    background 0.18s;
  cursor: default;
}

.drop-zone-dragging {
  border-color: rgba(34, 211, 238, 0.85);
  background: rgba(34, 211, 238, 0.08);
}

.drop-zone-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.drop-content {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex: 1;
  min-width: 0;
}

.drop-icon {
  color: rgba(34, 211, 238, 0.75);
  flex-shrink: 0;
}

.drop-label {
  color: #e2e8f0;
  font-size: 0.78rem;
  font-weight: 600;
}

.drop-hint {
  color: #64748b;
  font-size: 0.7rem;
  white-space: nowrap;
}

.upload-pick-btn {
  flex-shrink: 0;
  padding: 0.42rem 0.8rem;
  border-radius: 0.62rem;
  border: 1px solid rgba(34, 211, 238, 0.5);
  background: rgba(34, 211, 238, 0.12);
  color: #67e8f9;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  transition:
    background 0.15s,
    border-color 0.15s;
  cursor: pointer;
}

.upload-pick-btn:hover {
  background: rgba(34, 211, 238, 0.22);
  border-color: rgba(34, 211, 238, 0.75);
}

.upload-pick-btn-disabled,
.upload-pick-btn:disabled {
  cursor: not-allowed;
  color: #94a3b8;
  border-color: rgba(100, 116, 139, 0.4);
  background: rgba(15, 23, 42, 0.45);
}

.upload-pick-btn:disabled:hover {
  background: rgba(15, 23, 42, 0.45);
  border-color: rgba(100, 116, 139, 0.4);
}

.upload-error {
  font-size: 0.72rem;
  color: #fca5a5;
  background: rgba(244, 63, 94, 0.12);
  border: 1px solid rgba(244, 63, 94, 0.3);
  border-radius: 0.5rem;
  padding: 0.3rem 0.6rem;
}
</style>
