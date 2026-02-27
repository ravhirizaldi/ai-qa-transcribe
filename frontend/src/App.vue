<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Mic } from "lucide-vue-next";
import { useSession } from "./services/session";

const route = useRoute();
const router = useRouter();
const session = useSession();

const isAuthenticated = computed(() => Boolean(session.token.value));
const isLoginPage = computed(() => route.path === "/login");

const logout = async () => {
  session.clear();
  await router.push("/login");
};
</script>

<template>
  <div class="relative min-h-screen app-shell">
    <div class="ambient-orb ambient-orb-a"></div>
    <div class="ambient-orb ambient-orb-b"></div>
    <div class="ambient-grid"></div>

    <nav class="sticky top-0 z-50 border-b border-white/10 bg-black/30 backdrop-blur-xl" v-if="!isLoginPage">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex flex-wrap gap-3 items-center justify-between py-4">
          <div class="flex items-center gap-4">
            <div class="brand-mark">
              <Mic class="w-5 h-5 text-white/95" />
            </div>
            <div>
              <p class="text-xs uppercase tracking-[0.24em] text-cyan-200/70">AI Voice QA Desk</p>
              <h1 class="text-lg sm:text-xl font-semibold text-white title-font">Recording QA Workspace</h1>
            </div>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <div class="page-switch" v-if="isAuthenticated">
              <RouterLink to="/manage" class="page-link" active-class="page-link-active">Manage</RouterLink>
              <RouterLink to="/settings" class="page-link" active-class="page-link-active">Settings</RouterLink>
              <RouterLink to="/single" class="page-link" active-class="page-link-active">Single QA</RouterLink>
              <RouterLink to="/batch" class="page-link" active-class="page-link-active">Batch QA</RouterLink>
            </div>
            <button v-if="isAuthenticated" @click="logout" class="logout-btn">Logout</button>
          </div>
        </div>
      </div>
    </nav>

    <main class="relative z-10 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  background:
    radial-gradient(1200px 700px at 10% -20%, rgba(6, 182, 212, 0.2), transparent 70%),
    radial-gradient(1200px 700px at 100% 0%, rgba(56, 189, 248, 0.15), transparent 60%),
    #020617;
}

.ambient-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(42px);
  opacity: 0.55;
  pointer-events: none;
}

.ambient-orb-a {
  width: 18rem;
  height: 18rem;
  top: 5rem;
  left: -5rem;
  background: rgba(34, 211, 238, 0.25);
}

.ambient-orb-b {
  width: 22rem;
  height: 22rem;
  right: -6rem;
  bottom: 8rem;
  background: rgba(14, 165, 233, 0.2);
}

.ambient-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(circle at 50% 30%, black 30%, transparent 80%);
}

.title-font {
  font-family: var(--font-display);
}

.brand-mark {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.9rem;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, rgba(34, 211, 238, 0.9), rgba(14, 116, 144, 0.9));
  box-shadow: 0 10px 30px rgba(6, 182, 212, 0.35);
}

.page-switch {
  display: inline-flex;
  gap: 0.35rem;
  padding: 0.22rem;
  border-radius: 0.8rem;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.65);
}

.page-link {
  border-radius: 0.62rem;
  padding: 0.45rem 0.82rem;
  color: #94a3b8;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.page-link:hover {
  color: #e2e8f0;
}

.page-link-active {
  color: #082f49;
  background: linear-gradient(180deg, rgba(34, 211, 238, 0.95), rgba(6, 182, 212, 0.9));
}

.logout-btn {
  border-radius: 0.62rem;
  padding: 0.45rem 0.82rem;
  color: #fecaca;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid rgba(248, 113, 113, 0.45);
  background: rgba(127, 29, 29, 0.32);
}
</style>
