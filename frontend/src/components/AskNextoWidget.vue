<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  LoaderCircle,
  MessageCircleMore,
  SendHorizontal,
  ShieldAlert,
  Square,
  X,
} from "lucide-vue-next";
import {
  listProjects,
  listTenants,
  streamAssistantChat,
  type AssistantChatMetaEvent,
  type Project,
  type Tenant,
} from "../services/backendApi";
import { useSession } from "../services/session";

type ChatRole = "assistant" | "user" | "system";
type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
};

const session = useSession();
const isOpen = ref(false);
const loadingContext = ref(false);
const loadingProjects = ref(false);
const sending = ref(false);
const syncingSelection = ref(false);
const loadError = ref("");
const inputText = ref("");
const tenants = ref<Tenant[]>([]);
const projects = ref<Project[]>([]);
const selectedTenantId = ref("");
const selectedProjectId = ref("");
const previousResponseId = ref<string | null>(null);
const messages = ref<ChatMessage[]>([]);
const listContainerRef = ref<HTMLElement | null>(null);
const streamAbortController = ref<AbortController | null>(null);

const hasContext = computed(
  () => Boolean(selectedTenantId.value && selectedProjectId.value),
);
const canSend = computed(
  () => hasContext.value && !sending.value && Boolean(inputText.value.trim()),
);
const selectedTenantName = computed(
  () =>
    tenants.value.find((tenant) => tenant.id === selectedTenantId.value)?.name ||
    "Tenant",
);
const selectedProjectName = computed(
  () =>
    projects.value.find((project) => project.id === selectedProjectId.value)?.name ||
    "Project",
);

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const scrollToBottom = async () => {
  await nextTick();
  const element = listContainerRef.value;
  if (!element) return;
  element.scrollTop = element.scrollHeight;
};

const setMessages = (next: ChatMessage[]) => {
  messages.value = next;
  void scrollToBottom();
};

const pushMessage = (role: ChatRole, text: string) => {
  const message: ChatMessage = {
    id: makeId(role),
    role,
    text,
    createdAt: new Date().toISOString(),
  };
  setMessages([...messages.value, message]);
  return message.id;
};

const updateMessage = (messageId: string, updater: (current: ChatMessage) => ChatMessage) => {
  setMessages(
    messages.value.map((message) => (message.id === messageId ? updater(message) : message)),
  );
};

const defaultWelcomeMessage = (): ChatMessage => ({
  id: makeId("assistant"),
  role: "assistant",
  text: "Halo, saya Nexto. Saya hanya membantu QA operasional. Contoh: \"berapa recording analyzed hari ini?\" atau \"berapa QA score batch terbaru?\"",
  createdAt: new Date().toISOString(),
});

const defaultContextMessage = (): ChatMessage => ({
  id: makeId("system"),
  role: "system",
  text: "Pilih tenant dan project terlebih dulu untuk mulai chat.",
  createdAt: new Date().toISOString(),
});

const resetChatState = () => {
  previousResponseId.value = null;
  inputText.value = "";
  if (hasContext.value) {
    setMessages([defaultWelcomeMessage()]);
  } else {
    setMessages([defaultContextMessage()]);
  }
};

const loadProjectsForTenant = async (tenantId: string) => {
  if (!tenantId) {
    projects.value = [];
    syncingSelection.value = true;
    selectedProjectId.value = "";
    syncingSelection.value = false;
    return;
  }

  loadingProjects.value = true;
  try {
    const projectRows = await listProjects(tenantId);
    projects.value = projectRows;

    const preferredProjectId = selectedProjectId.value;
    const nextProjectId =
      projectRows.find((project) => project.id === preferredProjectId)?.id || "";

    syncingSelection.value = true;
    selectedProjectId.value = nextProjectId;
    syncingSelection.value = false;
  } catch (error) {
    projects.value = [];
    syncingSelection.value = true;
    selectedProjectId.value = "";
    syncingSelection.value = false;
    loadError.value =
      error instanceof Error ? error.message : "Gagal memuat project.";
  } finally {
    loadingProjects.value = false;
  }
};

const loadContextOptions = async () => {
  if (!session.token.value) return;
  loadingContext.value = true;
  loadError.value = "";

  try {
    const tenantRows = await listTenants();
    tenants.value = tenantRows;

    const preferredTenantId = selectedTenantId.value;
    const nextTenantId =
      tenantRows.find((tenant) => tenant.id === preferredTenantId)?.id || "";

    syncingSelection.value = true;
    selectedTenantId.value = nextTenantId;
    syncingSelection.value = false;

    await loadProjectsForTenant(nextTenantId);
  } catch (error) {
    loadError.value =
      error instanceof Error ? error.message : "Gagal memuat konteks chat.";
  } finally {
    loadingContext.value = false;
  }
};

const stopStreaming = () => {
  streamAbortController.value?.abort();
};

const clearChat = () => {
  stopStreaming();
  sending.value = false;
  streamAbortController.value = null;
  resetChatState();
};

const sendMessage = async () => {
  const text = inputText.value.trim();
  if (!text || sending.value) return;

  if (!hasContext.value) {
    pushMessage("system", "Pilih tenant dan project sebelum mengirim pertanyaan.");
    return;
  }

  inputText.value = "";
  pushMessage("user", text);
  const assistantMessageId = pushMessage("assistant", "");

  sending.value = true;
  const abortController = new AbortController();
  streamAbortController.value = abortController;
  let receivedToken = false;
  let receivedError = false;

  const onMeta = (meta: AssistantChatMetaEvent) => {
    previousResponseId.value =
      typeof meta.responseId === "string" && meta.responseId.trim()
        ? meta.responseId
        : null;
  };

  try {
    await streamAssistantChat(
      {
        tenantId: selectedTenantId.value,
        projectId: selectedProjectId.value,
        message: text,
        previousResponseId: previousResponseId.value || undefined,
      },
      {
        signal: abortController.signal,
        onToken: (token) => {
          receivedToken = true;
          updateMessage(assistantMessageId, (current) => ({
            ...current,
            text: `${current.text}${token}`,
          }));
        },
        onMeta,
        onError: (message) => {
          receivedError = true;
          updateMessage(assistantMessageId, (current) => ({
            ...current,
            text: message || current.text || "Permintaan tidak dapat diproses.",
          }));
        },
        onDone: () => {},
      },
    );

    if (!receivedToken && !receivedError) {
      updateMessage(assistantMessageId, (current) => ({
        ...current,
        text: current.text || "Respons kosong. Silakan ulangi pertanyaan Anda.",
      }));
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      updateMessage(assistantMessageId, (current) => ({
        ...current,
        text: current.text || "Permintaan dibatalkan.",
      }));
    } else {
      const message =
        error instanceof Error ? error.message : "Gagal memproses permintaan chat.";
      updateMessage(assistantMessageId, (current) => ({
        ...current,
        text: current.text || message,
      }));
    }
  } finally {
    sending.value = false;
    streamAbortController.value = null;
  }
};

watch(
  () => session.token.value,
  (token) => {
    if (!token) {
      tenants.value = [];
      projects.value = [];
      selectedTenantId.value = "";
      selectedProjectId.value = "";
      previousResponseId.value = null;
      setMessages([]);
      return;
    }
    void loadContextOptions();
  },
  { immediate: true },
);

watch(
  selectedTenantId,
  (tenantId, previousTenantId) => {
    if (syncingSelection.value || tenantId === previousTenantId) return;
    void loadProjectsForTenant(tenantId);
    resetChatState();
  },
);

watch(selectedProjectId, () => {
  if (syncingSelection.value) return;
  resetChatState();
});

onMounted(() => {
  resetChatState();
  if (session.token.value) {
    void loadContextOptions();
  }
});
</script>

<template>
  <div class="nexto-widget">
    <button
      v-if="!isOpen"
      class="nexto-launcher"
      type="button"
      @click="isOpen = true"
    >
      <MessageCircleMore class="w-4 h-4" />
      <span>Ask Nexto</span>
    </button>

    <section v-else class="nexto-panel" aria-label="Ask Nexto">
      <header class="nexto-header">
        <div class="nexto-title-wrap">
          <p class="nexto-kicker">Support AI</p>
          <h3 class="nexto-title">Ask Nexto</h3>
        </div>
        <div class="nexto-header-actions">
          <button
            class="nexto-clear-btn"
            type="button"
            @click="clearChat"
            title="Hapus percakapan"
          >
            Clear Chat
          </button>
          <button
            v-if="sending"
            class="nexto-icon-btn nexto-stop-btn"
            type="button"
            @click="stopStreaming"
            title="Hentikan respons"
          >
            <Square class="w-3.5 h-3.5" />
          </button>
          <button
            class="nexto-icon-btn"
            type="button"
            @click="isOpen = false"
            title="Tutup chat"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </header>

      <div class="nexto-context">
        <div class="nexto-context-row">
          <label for="nexto-tenant">Tenant</label>
          <select
            id="nexto-tenant"
            v-model="selectedTenantId"
            :disabled="loadingContext || sending"
          >
            <option value="">Pilih tenant</option>
            <option v-for="tenant in tenants" :key="tenant.id" :value="tenant.id">
              {{ tenant.name }}
            </option>
          </select>
        </div>
        <div class="nexto-context-row">
          <label for="nexto-project">Project</label>
          <select
            id="nexto-project"
            v-model="selectedProjectId"
            :disabled="loadingProjects || sending || !selectedTenantId"
          >
            <option value="">Pilih project</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">
              {{ project.name }}
            </option>
          </select>
        </div>

        <div class="nexto-context-meta">
          <LoaderCircle
            v-if="loadingContext || loadingProjects"
            class="w-3.5 h-3.5 animate-spin"
          />
          <span v-else-if="hasContext">
            Context: {{ selectedTenantName }} / {{ selectedProjectName }}
          </span>
          <span v-else>Pilih context untuk mulai chat</span>
        </div>

        <p v-if="loadError" class="nexto-error">{{ loadError }}</p>
      </div>

      <div ref="listContainerRef" class="nexto-messages">
        <article
          v-for="message in messages"
          :key="message.id"
          :class="[
            'nexto-message',
            {
              'nexto-message-user': message.role === 'user',
              'nexto-message-assistant': message.role === 'assistant',
              'nexto-message-system': message.role === 'system',
            },
          ]"
        >
          <div class="nexto-message-role">
            <ShieldAlert v-if="message.role === 'system'" class="w-3.5 h-3.5" />
            <span>{{ message.role === "user" ? "Anda" : message.role === "assistant" ? "Nexto" : "System" }}</span>
          </div>
          <p class="nexto-message-text">{{ message.text }}</p>
        </article>
      </div>

      <form class="nexto-input-wrap" @submit.prevent="sendMessage">
        <textarea
          v-model="inputText"
          class="nexto-input"
          rows="2"
          :disabled="sending"
          :placeholder="
            hasContext
              ? 'Tanya metrik QA operasional...'
              : 'Pilih tenant & project dulu'
          "
          @keydown.enter.exact.prevent="sendMessage"
        ></textarea>
        <button class="nexto-send-btn" type="submit" :disabled="!canSend">
          <LoaderCircle v-if="sending" class="w-4 h-4 animate-spin" />
          <SendHorizontal v-else class="w-4 h-4" />
          <span>{{ sending ? "Mengirim..." : "Kirim" }}</span>
        </button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.nexto-widget {
  position: fixed;
  inset-inline-start: 1rem;
  inset-block-end: 1rem;
  z-index: 2147482000;
}

.nexto-launcher {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border-radius: 999px;
  border: 1px solid rgba(34, 211, 238, 0.5);
  background: linear-gradient(180deg, rgba(6, 182, 212, 0.95), rgba(14, 116, 144, 0.95));
  color: #ecfeff;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.6rem 0.95rem;
  box-shadow: 0 14px 34px rgba(6, 182, 212, 0.35);
}

.nexto-panel {
  width: min(380px, calc(100vw - 1.5rem));
  height: min(640px, calc(100vh - 1.5rem));
  border-radius: 1rem;
  border: 1px solid rgba(100, 116, 139, 0.4);
  background: rgba(2, 6, 23, 0.96);
  box-shadow: 0 28px 60px rgba(2, 6, 23, 0.65);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.nexto-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 0.85rem;
  border-bottom: 1px solid rgba(100, 116, 139, 0.35);
  background: rgba(15, 23, 42, 0.75);
}

.nexto-title-wrap {
  min-width: 0;
}

.nexto-kicker {
  margin: 0;
  color: #67e8f9;
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.nexto-title {
  margin: 0.15rem 0 0 0;
  color: #ecfeff;
  font-size: 0.94rem;
  font-weight: 700;
}

.nexto-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.nexto-clear-btn {
  border-radius: 0.52rem;
  border: 1px solid rgba(248, 113, 113, 0.45);
  background: rgba(127, 29, 29, 0.26);
  color: #fecaca;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.34rem 0.45rem;
}

.nexto-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.52rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(2, 6, 23, 0.45);
  color: #cbd5e1;
  width: 1.9rem;
  height: 1.9rem;
}

.nexto-stop-btn {
  color: #fde68a;
  border-color: rgba(245, 158, 11, 0.5);
}

.nexto-context {
  padding: 0.72rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-bottom: 1px solid rgba(100, 116, 139, 0.32);
  background: rgba(15, 23, 42, 0.52);
}

.nexto-context-row {
  display: grid;
  grid-template-columns: 4.3rem minmax(0, 1fr);
  align-items: center;
  gap: 0.55rem;
}

.nexto-context-row label {
  color: #cbd5e1;
  font-size: 0.72rem;
  font-weight: 600;
}

.nexto-context-row select {
  width: 100%;
  border-radius: 0.52rem;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(2, 6, 23, 0.55);
  color: #e2e8f0;
  font-size: 0.74rem;
  padding: 0.36rem 0.5rem;
}

.nexto-context-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  color: #94a3b8;
  font-size: 0.68rem;
}

.nexto-error {
  margin: 0;
  color: #fecaca;
  font-size: 0.68rem;
}

.nexto-messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.75rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  background:
    radial-gradient(circle at 20% 0%, rgba(34, 211, 238, 0.09), transparent 45%),
    rgba(2, 6, 23, 0.72);
}

.nexto-message {
  border-radius: 0.7rem;
  border: 1px solid rgba(100, 116, 139, 0.32);
  padding: 0.45rem 0.55rem;
  max-width: 94%;
}

.nexto-message-user {
  align-self: flex-end;
  border-color: rgba(34, 211, 238, 0.45);
  background: rgba(8, 145, 178, 0.2);
}

.nexto-message-assistant {
  align-self: flex-start;
  border-color: rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.7);
}

.nexto-message-system {
  align-self: center;
  border-color: rgba(245, 158, 11, 0.45);
  background: rgba(120, 53, 15, 0.35);
}

.nexto-message-role {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  color: #cbd5e1;
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.nexto-message-text {
  margin: 0.3rem 0 0 0;
  color: #f1f5f9;
  font-size: 0.76rem;
  line-height: 1.45;
  white-space: pre-wrap;
}

.nexto-input-wrap {
  border-top: 1px solid rgba(100, 116, 139, 0.32);
  background: rgba(15, 23, 42, 0.78);
  padding: 0.72rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.48rem;
}

.nexto-input {
  width: 100%;
  border-radius: 0.6rem;
  border: 1px solid rgba(100, 116, 139, 0.5);
  background: rgba(2, 6, 23, 0.55);
  color: #e2e8f0;
  resize: none;
  padding: 0.48rem 0.55rem;
  font-size: 0.76rem;
  line-height: 1.35;
}

.nexto-input:disabled {
  opacity: 0.65;
}

.nexto-send-btn {
  align-self: flex-end;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 0.58rem;
  border: 1px solid rgba(34, 211, 238, 0.48);
  color: #ecfeff;
  background: linear-gradient(180deg, rgba(6, 182, 212, 0.92), rgba(14, 116, 144, 0.92));
  font-size: 0.74rem;
  font-weight: 700;
  padding: 0.4rem 0.68rem;
}

.nexto-send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .nexto-widget {
    inset-inline-start: 0.6rem;
    inset-inline-end: 0.6rem;
    inset-block-end: 0.6rem;
  }

  .nexto-panel {
    width: 100%;
    height: min(72vh, 640px);
  }
}
</style>
