<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { login, register } from "../services/backendApi";
import { useSession } from "../services/session";

const router = useRouter();
const { setToken } = useSession();

const email = ref("");
const password = ref("");
const mode = ref<"login" | "register">("login");
const isSubmitting = ref(false);
const blockAutofill = ref(true);

const getAuthErrorMessage = (error: unknown) => {
  const msg = error instanceof Error ? error.message : "Authentication failed";
  if (msg.includes("401")) return "Invalid email or password.";
  if (msg.includes("409")) return "Email already registered.";
  if (msg.includes("Failed to fetch")) return "Cannot reach backend server.";
  return msg;
};

const submit = async () => {
  isSubmitting.value = true;

  try {
    const response =
      mode.value === "login"
        ? await login(email.value, password.value)
        : await register(email.value, password.value);

    setToken(response.token);
    toast.success(mode.value === "login" ? "Logged in" : "Account created");
    await router.push("/batch");
  } catch (error) {
    toast.error(getAuthErrorMessage(error));
  } finally {
    isSubmitting.value = false;
  }
};

const unlockInputs = () => {
  if (blockAutofill.value) blockAutofill.value = false;
};
</script>

<template>
  <section class="min-h-[78vh] grid place-items-center">
    <div
      class="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/70 backdrop-blur-xl p-7 shadow-2xl"
    >
      <p class="text-xs uppercase tracking-[0.25em] text-cyan-100/70">
        Account Access
      </p>
      <h2 class="text-3xl text-white font-semibold mt-2">
        {{ mode === "login" ? "Welcome Back" : "Create Account" }}
      </h2>
      <p class="text-sm text-slate-300 mt-2">
        {{
          mode === "login"
            ? "Login to continue to Nexto VoiceGuard."
            : "Register and start managing tenants and matrices."
        }}
      </p>

      <form class="mt-6 space-y-3" @submit.prevent="submit" autocomplete="off">
        <input
          type="text"
          name="fake_username"
          autocomplete="username"
          class="hidden"
          tabindex="-1"
        />
        <input
          type="password"
          name="fake_password"
          autocomplete="new-password"
          class="hidden"
          tabindex="-1"
        />
        <input
          v-model="email"
          type="email"
          placeholder="Email"
          name="qa_email_input"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          :readonly="blockAutofill"
          @focus="unlockInputs"
          class="w-full rounded-xl border border-slate-700/70 bg-slate-900/55 px-3 py-2.5 text-slate-100"
        />
        <input
          v-model="password"
          type="password"
          placeholder="Password"
          name="qa_password_input"
          autocomplete="new-password"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          :readonly="blockAutofill"
          @focus="unlockInputs"
          class="w-full rounded-xl border border-slate-700/70 bg-slate-900/55 px-3 py-2.5 text-slate-100"
        />

        <button
          type="submit"
          :disabled="isSubmitting || !email.trim() || !password.trim()"
          class="w-full px-4 py-2.5 rounded-xl bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {{
            isSubmitting
              ? "Please wait..."
              : mode === "login"
                ? "Login"
                : "Create Account"
          }}
        </button>

        <button
          type="button"
          @click="mode = mode === 'login' ? 'register' : 'login'"
          class="w-full text-xs text-slate-300 hover:text-cyan-200"
        >
          {{
            mode === "login"
              ? "Need an account? Register"
              : "Already have an account? Login"
          }}
        </button>
      </form>
    </div>
  </section>
</template>
