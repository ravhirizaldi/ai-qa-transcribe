<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { getAuthMeCached } from "../../services/backendApi";
import {
  SETTINGS_TABS,
  getAccessibleSettingsTabs,
  toPermissionSet,
} from "../../utils/settingsAccess";

const route = useRoute();
const router = useRouter();
const tabs = ref(SETTINGS_TABS);

const visibleTabs = computed(() => tabs.value);

const loadTabs = async () => {
  try {
    const me = await getAuthMeCached({ force: true });
    tabs.value = me.isRestricted
      ? getAccessibleSettingsTabs(toPermissionSet(me.permissions))
      : SETTINGS_TABS;
  } catch {
    tabs.value = [];
  }

  if (!tabs.value.length) {
    await router.replace("/batch");
    return;
  }

  const canAccessCurrentPath = tabs.value.some(
    (tab) => route.path === tab.to || route.path.startsWith(`${tab.to}/`),
  );

  if (!canAccessCurrentPath) {
    await router.replace(tabs.value[0]?.to ?? "/batch");
  }
};

onMounted(() => {
  void loadTabs();
});
</script>

<template>
  <section class="settings-shell">
    <header class="header">
      <p class="eyebrow">Settings</p>
      <h1 class="title">Administration</h1>
      <p class="subtitle">Manage users, dynamic roles, and global system configuration.</p>
    </header>

    <nav class="tabs">
      <RouterLink
        v-for="tab in visibleTabs"
        :key="tab.to"
        :to="tab.to"
        class="tab"
        active-class="tab-active"
      >
        {{ tab.label }}
      </RouterLink>
    </nav>

    <RouterView />
  </section>
</template>

<style scoped>
.settings-shell {
  display: grid;
  gap: 0.85rem;
}
.header {
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(2, 6, 23, 0.35);
  border-radius: 1rem;
  padding: 1rem;
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
  font-size: 1.4rem;
  font-weight: 700;
}
.subtitle {
  margin-top: 0.35rem;
  color: #94a3b8;
  font-size: 0.86rem;
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.tab {
  border-radius: 0.62rem;
  padding: 0.45rem 0.82rem;
  color: #94a3b8;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.65);
}
.tab-active {
  color: #082f49;
  border-color: transparent;
  background: linear-gradient(180deg, rgba(34, 211, 238, 0.95), rgba(6, 182, 212, 0.9));
}
</style>
