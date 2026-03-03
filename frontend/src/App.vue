<script setup lang="ts">
import { ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Mic, LayoutDashboard, Users, Settings, LogOut } from "lucide-vue-next";
import { useSession } from "./services/session";

const route = useRoute();
const router = useRouter();
const session = useSession();

const isAuthenticated = computed(() => Boolean(session.token.value));
const isLoginPage = computed(() => route.path === "/login");
const isSettingsRoute = computed(() => route.path.startsWith("/settings"));

const showLogoutConfirm = ref(false);

const logout = () => {
  showLogoutConfirm.value = true;
};

const confirmLogoutAction = async () => {
  session.clear();
  showLogoutConfirm.value = false;
  await router.push("/login");
};
</script>

<template>
  <div class="relative min-h-screen app-shell">
    <div class="ambient-orb ambient-orb-a"></div>
    <div class="ambient-orb ambient-orb-b"></div>
    <div class="ambient-grid"></div>

    <nav
      class="sticky top-0 z-50 border-b border-white/10 bg-black/30 backdrop-blur-xl"
      v-if="!isLoginPage"
    >
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex flex-wrap gap-3 items-center justify-between py-4">
          <div class="flex items-center gap-4">
            <div class="brand-mark">
              <Mic class="w-5 h-5 text-white/95" />
            </div>
            <div>
              <p class="text-xs uppercase tracking-[0.24em] text-cyan-200/70">
                Nexto VoiceGuard
              </p>
              <h1
                class="text-lg sm:text-xl font-semibold text-white title-font"
              >
                Intelligent QA Hub
              </h1>
            </div>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <div class="page-switch" v-if="isAuthenticated">
              <RouterLink
                to="/batch"
                class="page-link"
                active-class="page-link-active"
              >
                <LayoutDashboard class="w-4 h-4" />
                <span>QA Calculation</span>
              </RouterLink>
              <RouterLink
                to="/manage"
                class="page-link"
                active-class="page-link-active"
              >
                <Users class="w-4 h-4" />
                <span>Tenants</span>
              </RouterLink>
              <RouterLink
                to="/settings/users"
                :class="['page-link', { 'page-link-active': isSettingsRoute }]"
              >
                <Settings class="w-4 h-4" />
                <span>Settings</span>
              </RouterLink>
            </div>
            <button v-if="isAuthenticated" @click="logout" class="logout-btn">
              <LogOut class="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </div>
    </nav>

    <main
      class="relative z-10 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6"
    >
      <RouterView />
    </main>

    <!-- Custom Logout Confirmation Modal -->
    <div
      v-if="showLogoutConfirm"
      class="overlay"
      @click.self="showLogoutConfirm = false"
    >
      <div class="modal-card">
        <h3 class="modal-title">Confirm Logout</h3>
        <p class="text-sm text-slate-300">
          Are you sure you want to logout? Your active session will be
          terminated.
        </p>
        <div class="modal-actions">
          <button class="btn-ghost" @click="showLogoutConfirm = false">
            Cancel
          </button>
          <button class="logout-confirm-btn" @click="confirmLogoutAction">
            Logout Now
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  background:
    radial-gradient(
      1200px 700px at 10% -20%,
      rgba(6, 182, 212, 0.2),
      transparent 70%
    ),
    radial-gradient(
      1200px 700px at 100% 0%,
      rgba(56, 189, 248, 0.15),
      transparent 60%
    ),
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
  background: linear-gradient(
    135deg,
    rgba(34, 211, 238, 0.9),
    rgba(14, 116, 144, 0.9)
  );
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
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.page-link:hover {
  color: #e2e8f0;
}

.page-link-active {
  color: #082f49;
  background: linear-gradient(
    180deg,
    rgba(34, 211, 238, 0.95),
    rgba(6, 182, 212, 0.9)
  );
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
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Modal Shared Styles (matching ManagePage pattern) */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(2, 6, 23, 0.85);
  backdrop-filter: blur(8px);
  display: grid;
  place-items: center;
  padding: 1rem;
}

.modal-card {
  width: min(400px, 100%);
  border-radius: 1.25rem;
  border: 1px solid rgba(100, 116, 139, 0.5);
  background: rgba(15, 23, 42, 0.98);
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  animation: modal-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modal-enter {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.modal-title {
  color: #f8fafc;
  font-size: 1.1rem;
  font-weight: 700;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.btn-ghost {
  border-radius: 0.75rem;
  padding: 0.5rem 1rem;
  color: #94a3b8;
  font-size: 0.85rem;
  font-weight: 600;
  background: transparent;
  border: 1px solid transparent;
  transition: all 0.2s;
}

.btn-ghost:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #e2e8f0;
}

.logout-confirm-btn {
  border-radius: 0.75rem;
  padding: 0.5rem 1.25rem;
  color: #fecaca;
  font-size: 0.85rem;
  font-weight: 700;
  border: 1px solid rgba(248, 113, 113, 0.4);
  background: rgba(153, 27, 27, 0.4);
  transition: all 0.2s;
}

.logout-confirm-btn:hover {
  background: rgba(153, 27, 27, 0.6);
  border-color: rgba(248, 113, 113, 0.6);
  box-shadow: 0 0 15px rgba(239, 68, 68, 0.2);
}
</style>
