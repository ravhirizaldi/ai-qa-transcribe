<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { login, register } from "../services/backendApi";
import { useSession } from "../services/session";

const router = useRouter();
const { setToken } = useSession();

const email = ref("");
const password = ref("");
const mode = ref<"login" | "register">("login");
const isSubmitting = ref(false);
const errorMessage = ref("");

const submit = async () => {
  isSubmitting.value = true;
  errorMessage.value = "";

  try {
    const response =
      mode.value === "login"
        ? await login(email.value, password.value)
        : await register(email.value, password.value);

    setToken(response.token);
    await router.push("/manage");
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Authentication failed";
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <section class="max-w-md mx-auto rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-6 mt-10">
    <p class="text-xs uppercase tracking-[0.22em] text-cyan-100/70">Account Access</p>
    <h2 class="text-2xl text-white font-semibold mt-1">{{ mode === "login" ? "Login" : "Register" }}</h2>

    <div class="mt-5 space-y-3">
      <input
        v-model="email"
        type="email"
        placeholder="Email"
        class="w-full rounded-lg border border-slate-700/70 bg-slate-900/55 px-3 py-2 text-slate-100"
      />
      <input
        v-model="password"
        type="password"
        placeholder="Password"
        class="w-full rounded-lg border border-slate-700/70 bg-slate-900/55 px-3 py-2 text-slate-100"
      />

      <p v-if="errorMessage" class="text-xs text-rose-300">{{ errorMessage }}</p>

      <button
        @click="submit"
        :disabled="isSubmitting"
        class="w-full px-4 py-2.5 rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors font-semibold text-sm"
      >
        {{ isSubmitting ? "Please wait..." : mode === "login" ? "Login" : "Create Account" }}
      </button>

      <button
        @click="mode = mode === 'login' ? 'register' : 'login'"
        class="w-full text-xs text-slate-300 hover:text-cyan-200"
      >
        {{ mode === "login" ? "Need an account? Register" : "Already have an account? Login" }}
      </button>
    </div>
  </section>
</template>
