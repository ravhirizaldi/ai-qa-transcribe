<script setup lang="ts">
import { computed } from "vue";
import BatchQAWorkspace from "../components/BatchQAWorkspace.vue";
import { useSession } from "../services/session";

const session = useSession();
const hasApiKeys = computed(() => {
  const hasApi = !!import.meta.env.VITE_API_BASE_URL;
  const hasTenant = !!session.tenantId.value;
  const hasProject = !!session.projectId.value;
  const hasToken = !!session.token.value;
  return hasApi && hasTenant && hasProject && hasToken;
});
</script>

<template>
  <BatchQAWorkspace :has-api-keys="hasApiKeys" />
</template>
