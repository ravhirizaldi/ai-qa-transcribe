<script setup lang="ts">
import { RouterLink } from "vue-router";

const tabs = [
  { to: "/settings/users", label: "Users" },
  { to: "/settings/roles", label: "Roles" },
  { to: "/settings/system", label: "System" },
];
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
        v-for="tab in tabs"
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
