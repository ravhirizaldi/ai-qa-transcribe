<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  createProject,
  createTenant,
  deleteProject,
  deleteTenant,
  listProjects,
  listTenants,
  updateProject,
  updateTenant,
  type Project,
  type Tenant,
} from "../services/backendApi";
import { useSession } from "../services/session";

const { tenantId, projectId, setTenantId, setProjectId } = useSession();

const tenants = ref<Tenant[]>([]);
const projects = ref<Project[]>([]);
const loading = ref(false);
const errorMessage = ref("");

const newTenantName = ref("");
const newTenantLogo = ref("");

const newProjectName = ref("");
const newProjectInbound = ref(true);
const newProjectOutbound = ref(false);

const activeTenant = computed(() => tenants.value.find((tenant) => tenant.id === tenantId.value) || null);

const loadTenants = async () => {
  loading.value = true;
  errorMessage.value = "";
  try {
    tenants.value = await listTenants();
    if (!tenantId.value && tenants.value.length) {
      const firstTenant = tenants.value[0];
      if (firstTenant) setTenantId(firstTenant.id);
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Failed to load tenants";
  } finally {
    loading.value = false;
  }
};

const loadProjects = async () => {
  if (!tenantId.value) {
    projects.value = [];
    return;
  }
  try {
    projects.value = await listProjects(tenantId.value);
    if (!projects.value.find((p) => p.id === projectId.value)) {
      setProjectId(projects.value[0]?.id || "");
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Failed to load projects";
  }
};

const createTenantAction = async () => {
  if (!newTenantName.value.trim()) return;
  const tenant = await createTenant({
    name: newTenantName.value,
    logoUrl: newTenantLogo.value.trim() || null,
  });
  tenants.value.push(tenant);
  setTenantId(tenant.id);
  newTenantName.value = "";
  newTenantLogo.value = "";
  await loadProjects();
};

const updateTenantAction = async (tenant: Tenant) => {
  const name = prompt("Tenant name", tenant.name);
  if (name === null) return;
  const logoUrl = prompt("Tenant logo URL", tenant.logoUrl || "");
  const updated = await updateTenant(tenant.id, {
    name,
    logoUrl: logoUrl === null ? tenant.logoUrl || null : logoUrl || null,
  });
  tenants.value = tenants.value.map((t) => (t.id === updated.id ? updated : t));
};

const deleteTenantAction = async (tenant: Tenant) => {
  const confirmed = confirm(`Delete tenant ${tenant.name}? This will remove all projects/jobs.`);
  if (!confirmed) return;
  await deleteTenant(tenant.id);
  tenants.value = tenants.value.filter((t) => t.id !== tenant.id);
  if (tenantId.value === tenant.id) {
    setTenantId(tenants.value[0]?.id || "");
  }
  await loadProjects();
};

const createProjectAction = async () => {
  if (!tenantId.value || !newProjectName.value.trim()) return;
  const project = await createProject(tenantId.value, {
    name: newProjectName.value,
    supportsInbound: newProjectInbound.value,
    supportsOutbound: newProjectOutbound.value,
  });
  projects.value.push(project);
  setProjectId(project.id);
  newProjectName.value = "";
  newProjectInbound.value = true;
  newProjectOutbound.value = false;
};

const updateProjectAction = async (project: Project) => {
  if (!tenantId.value) return;
  const name = prompt("Project name", project.name);
  if (name === null) return;

  const inbound = confirm("Enable inbound? Click cancel for false.");
  const outbound = confirm("Enable outbound? Click cancel for false.");

  const updated = await updateProject(tenantId.value, project.id, {
    name,
    supportsInbound: inbound,
    supportsOutbound: outbound,
  });
  projects.value = projects.value.map((p) => (p.id === updated.id ? updated : p));
};

const deleteProjectAction = async (project: Project) => {
  if (!tenantId.value) return;
  const confirmed = confirm(`Delete project ${project.name}? This will remove all jobs/matrices.`);
  if (!confirmed) return;
  await deleteProject(tenantId.value, project.id);
  projects.value = projects.value.filter((p) => p.id !== project.id);
  if (projectId.value === project.id) {
    setProjectId(projects.value[0]?.id || "");
  }
};

watch(
  () => tenantId.value,
  () => {
    void loadProjects();
  },
);

onMounted(async () => {
  await loadTenants();
  await loadProjects();
});
</script>

<template>
  <section class="grid grid-cols-1 xl:grid-cols-2 gap-6">
    <div class="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-5">
      <p class="text-xs uppercase tracking-[0.22em] text-cyan-100/70">Tenant Management</p>
      <h2 class="text-xl text-white font-semibold mt-1">Tenants</h2>

      <div class="mt-4 space-y-2">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input v-model="newTenantName" placeholder="Tenant name" class="input" />
          <input v-model="newTenantLogo" placeholder="Logo URL (optional)" class="input" />
        </div>
        <button @click="createTenantAction" class="btn-primary">Create Tenant</button>
      </div>

      <p v-if="errorMessage" class="text-xs text-rose-300 mt-2">{{ errorMessage }}</p>
      <p v-if="loading" class="text-xs text-slate-400 mt-2">Loading...</p>

      <div class="mt-4 space-y-2">
        <button
          v-for="tenant in tenants"
          :key="tenant.id"
          class="w-full text-left p-3 rounded-lg border border-slate-700/60 bg-slate-900/40"
          :class="{ 'ring-1 ring-cyan-400/60': tenantId === tenant.id }"
          @click="setTenantId(tenant.id)"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-slate-100 font-medium">{{ tenant.name }}</p>
              <p class="text-xs text-slate-400">{{ tenant.id }}</p>
            </div>
            <div class="flex gap-1">
              <button @click.stop="updateTenantAction(tenant)" class="btn-ghost">Edit</button>
              <button @click.stop="deleteTenantAction(tenant)" class="btn-danger">Delete</button>
            </div>
          </div>
        </button>
      </div>
    </div>

    <div class="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-5">
      <p class="text-xs uppercase tracking-[0.22em] text-cyan-100/70">Project Management</p>
      <h2 class="text-xl text-white font-semibold mt-1">Projects</h2>
      <p class="text-xs text-slate-400 mt-1">Active tenant: {{ activeTenant?.name || "none" }}</p>

      <div class="mt-4 space-y-2">
        <input v-model="newProjectName" placeholder="Project name" class="input" />
        <div class="flex gap-4 text-sm text-slate-200">
          <label><input type="checkbox" v-model="newProjectInbound" /> Inbound</label>
          <label><input type="checkbox" v-model="newProjectOutbound" /> Outbound</label>
        </div>
        <button @click="createProjectAction" class="btn-primary">Create Project</button>
      </div>

      <div class="mt-4 space-y-2">
        <button
          v-for="project in projects"
          :key="project.id"
          class="w-full text-left p-3 rounded-lg border border-slate-700/60 bg-slate-900/40"
          :class="{ 'ring-1 ring-cyan-400/60': projectId === project.id }"
          @click="setProjectId(project.id)"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-slate-100 font-medium">{{ project.name }}</p>
              <p class="text-xs text-slate-400">{{ project.supportsInbound ? "Inbound" : "" }} {{ project.supportsOutbound ? "Outbound" : "" }}</p>
            </div>
            <div class="flex gap-1">
              <button @click.stop="updateProjectAction(project)" class="btn-ghost">Edit</button>
              <button @click.stop="deleteProjectAction(project)" class="btn-danger">Delete</button>
            </div>
          </div>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.input {
  width: 100%;
  border-radius: 0.6rem;
  border: 1px solid rgba(100, 116, 139, 0.55);
  background: rgba(15, 23, 42, 0.6);
  color: #e2e8f0;
  padding: 0.55rem 0.7rem;
}

.btn-primary {
  padding: 0.55rem 0.75rem;
  border-radius: 0.6rem;
  font-size: 0.82rem;
  font-weight: 700;
  color: #082f49;
  background: linear-gradient(180deg, rgba(34, 211, 238, 0.95), rgba(8, 145, 178, 0.95));
}

.btn-ghost {
  padding: 0.35rem 0.55rem;
  border-radius: 0.5rem;
  font-size: 0.72rem;
  color: #cbd5e1;
  border: 1px solid rgba(100, 116, 139, 0.55);
}

.btn-danger {
  padding: 0.35rem 0.55rem;
  border-radius: 0.5rem;
  font-size: 0.72rem;
  color: #fecaca;
  border: 1px solid rgba(248, 113, 113, 0.55);
  background: rgba(127, 29, 29, 0.32);
}
</style>
