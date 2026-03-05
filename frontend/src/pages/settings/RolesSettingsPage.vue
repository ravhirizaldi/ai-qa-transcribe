<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import {
  AVAILABLE_PERMISSION_KEYS,
  createAccessRole,
  deleteAccessRole,
  listAccessRoles,
  updateAccessRole,
  type AccessRole,
  type PermissionKey,
} from "../../services/backendApi";

const route = useRoute();
const router = useRouter();

const roles = ref<AccessRole[]>([]);
const loading = ref(false);
const saving = ref(false);
const editingRoleId = ref<string | null>(null);
const syncingRoute = ref(false);

const form = ref({
  name: "",
  description: "",
  permissions: [] as PermissionKey[],
});

const isEditing = computed(() => Boolean(editingRoleId.value));

const permissionDescriptions: Record<PermissionKey, string> = {
  "qa.read":
    "Read-only QA access: view scoped projects, batches, recordings, matrix, and calculation results.",
  "tenants:view":
    "View tenant entries that are in your scope.",
  "tenants:manage":
    "Create, edit, and delete tenants, including tenant-level membership operations.",
  "projects:view":
    "View project entries and project metadata in your scope.",
  "projects:manage":
    "Create, edit, and delete projects in scoped tenants.",
  "matrices:view":
    "View QA matrix versions and active matrix rows for scoped projects.",
  "matrices:manage":
    "Create, update, activate, and delete matrix versions in scoped projects.",
  "jobs:manage":
    "Manage QA processing flow: create batch, upload files, run analyze, retry, and delete jobs/batches.",
  "scores:manage":
    "Edit completed recording score rows and view score edit audit history.",
  "settings:view":
    "View administration settings pages and non-sensitive configuration status.",
  "settings:manage":
    "Manage settings-level configuration where applicable.",
  "users:manage":
    "Create users, edit user profiles, and assign access scopes/roles.",
  "roles:manage":
    "Create, edit, and delete access roles and their permissions.",
  "system:manage":
    "Update system-wide sensitive settings such as provider keys and models.",
};

const resetForm = () => {
  editingRoleId.value = null;
  form.value = { name: "", description: "", permissions: [] };
};

const load = async () => {
  loading.value = true;
  try {
    roles.value = await listAccessRoles();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to load roles");
  } finally {
    loading.value = false;
  }
};

const togglePermission = (permission: PermissionKey) => {
  const set = new Set(form.value.permissions);
  if (set.has(permission)) {
    set.delete(permission);
  } else {
    set.add(permission);
  }
  form.value.permissions = [...set];
};

const editRole = (role: AccessRole) => {
  editingRoleId.value = role.id;
  form.value = {
    name: role.name,
    description: role.description || "",
    permissions: [...role.permissions],
  };
};

const save = async () => {
  if (!form.value.name.trim()) {
    toast.error("Role name is required");
    return;
  }
  if (!form.value.permissions.length) {
    toast.error("Select at least one permission");
    return;
  }

  saving.value = true;
  try {
    if (editingRoleId.value) {
      const updated = await updateAccessRole(editingRoleId.value, {
        name: form.value.name.trim(),
        description: form.value.description.trim() || null,
        permissions: form.value.permissions,
      });
      toast.success("Role updated");
      await load();
      const refreshed = roles.value.find((item) => item.id === updated.id);
      if (refreshed) {
        editRole(refreshed);
      }
    } else {
      const created = await createAccessRole({
        name: form.value.name.trim(),
        description: form.value.description.trim() || null,
        permissions: form.value.permissions,
      });
      toast.success("Role created");
      await load();
      const refreshed = roles.value.find((item) => item.id === created.id);
      if (refreshed) {
        editRole(refreshed);
      } else {
        resetForm();
      }
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to save role");
  } finally {
    saving.value = false;
  }
};

const removeRole = async (role: AccessRole) => {
  if (!confirm(`Delete role "${role.name}"?`)) return;
  try {
    await deleteAccessRole(role.id);
    roles.value = roles.value.filter((item) => item.id !== role.id);
    if (editingRoleId.value === role.id) {
      resetForm();
    }
    toast.success("Role deleted");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to delete role");
  }
};

onMounted(() => {
  void load();
});

watch(
  () => editingRoleId.value,
  async (roleId) => {
    if (syncingRoute.value) return;
    const current = typeof route.query.role === "string" ? route.query.role : "";
    const next = roleId || "";
    if (current === next) return;

    syncingRoute.value = true;
    await router.replace({
      path: "/settings/roles",
      query: {
        ...route.query,
        role: next || undefined,
      },
    });
    syncingRoute.value = false;
  },
);

watch(
  () => route.query.role,
  (roleQuery) => {
    if (syncingRoute.value) return;
    const roleId = typeof roleQuery === "string" ? roleQuery : "";
    if (!roleId) {
      if (editingRoleId.value) resetForm();
      return;
    }
    const role = roles.value.find((item) => item.id === roleId);
    if (role && editingRoleId.value !== role.id) {
      editRole(role);
    }
  },
);

watch(
  () => roles.value,
  () => {
    const roleId = typeof route.query.role === "string" ? route.query.role : "";
    if (!roleId) return;
    const role = roles.value.find((item) => item.id === roleId);
    if (role && editingRoleId.value !== role.id) {
      editRole(role);
    }
  },
);
</script>

<template>
  <section class="panel">
    <div class="split">
      <div class="role-list">
        <div class="section-head">
          <p class="eyebrow">Roles</p>
          <h2 class="title">Access Roles</h2>
        </div>
        <p v-if="loading" class="muted">Loading roles...</p>
        <div v-else class="list">
          <div
            v-for="role in roles"
            :key="role.id"
            class="role-item"
            :class="{ selected: editingRoleId === role.id }"
            @click="editRole(role)"
            @keydown.enter.prevent="editRole(role)"
            @keydown.space.prevent="editRole(role)"
            role="button"
            tabindex="0"
          >
            <div class="role-item-header">
              <strong>{{ role.name }}</strong>
              <span class="pill">{{ role.assignmentCount }} users</span>
            </div>
            <p class="muted">{{ role.description || "No description" }}</p>
            <p class="muted tiny">{{ role.permissions.join(", ") }}</p>
            <button class="danger-link" @click.stop="removeRole(role)">Delete</button>
          </div>
        </div>
      </div>

      <div class="editor">
        <p class="eyebrow">{{ isEditing ? "Edit" : "Create" }}</p>
        <h3 class="subtitle">{{ isEditing ? "Edit Role" : "New Role" }}</h3>

        <label class="label">Role Name</label>
        <input v-model="form.name" class="input" placeholder="QA_Samsung_View" />

        <label class="label">Description</label>
        <textarea
          v-model="form.description"
          class="input"
          rows="2"
          placeholder="Explain what this role can do."
        ></textarea>

        <p class="label" style="margin-top: 0.7rem">Permissions</p>
        <div class="permission-grid">
          <label
            v-for="permission in AVAILABLE_PERMISSION_KEYS"
            :key="permission"
            class="check-row perm-check"
          >
            <input
              type="checkbox"
              :checked="form.permissions.includes(permission)"
              @change="togglePermission(permission)"
            />
            <span>{{ permission }}</span>
            <span class="perm-help" tabindex="0" aria-label="Permission description">
              ?
            </span>
            <span class="perm-tooltip">
              {{ permissionDescriptions[permission] }}
            </span>
          </label>
        </div>

        <div class="actions">
          <button class="btn-ghost" @click="resetForm">Reset</button>
          <button class="btn-primary" :disabled="saving" @click="save">
            {{ saving ? "Saving..." : isEditing ? "Update Role" : "Create Role" }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 1rem;
  padding: 1rem;
  background: rgba(2, 6, 23, 0.35);
}
.split {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
.section-head {
  margin-bottom: 0.65rem;
}
.eyebrow {
  color: #a5f3fc;
  font-size: 0.74rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.title,
.subtitle {
  color: #f8fafc;
  font-weight: 700;
  margin-top: 0.2rem;
}
.subtitle {
  font-size: 1.05rem;
}
.list {
  display: grid;
  gap: 0.55rem;
}
.role-item {
  cursor: pointer;
  text-align: left;
  border: 1px solid rgba(100, 116, 139, 0.4);
  background: rgba(15, 23, 42, 0.6);
  border-radius: 0.75rem;
  padding: 0.7rem;
}
.role-item:focus-visible {
  outline: 2px solid rgba(34, 211, 238, 0.8);
  outline-offset: 2px;
}
.selected {
  border-color: rgba(34, 211, 238, 0.7);
}
.role-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pill {
  font-size: 0.68rem;
  color: #082f49;
  background: rgba(34, 211, 238, 0.9);
  border-radius: 999px;
  padding: 0.12rem 0.5rem;
}
.danger-link {
  color: #fca5a5;
  font-size: 0.75rem;
  margin-top: 0.4rem;
}
.muted {
  color: #94a3b8;
  font-size: 0.8rem;
}
.tiny {
  font-size: 0.7rem;
  margin-top: 0.25rem;
}
.editor {
  border: 1px solid rgba(100, 116, 139, 0.35);
  border-radius: 0.75rem;
  background: rgba(15, 23, 42, 0.6);
  padding: 0.75rem;
}
.label {
  display: block;
  margin-top: 0.55rem;
  color: #cbd5e1;
  font-size: 0.78rem;
}
.input {
  width: 100%;
  margin-top: 0.25rem;
  border-radius: 0.6rem;
  border: 1px solid rgba(100, 116, 139, 0.55);
  background: rgba(15, 23, 42, 0.6);
  color: #e2e8f0;
  padding: 0.5rem 0.65rem;
  font-size: 0.82rem;
}
.permission-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.35rem;
  margin-top: 0.35rem;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: #cbd5e1;
  font-size: 0.8rem;
  position: relative;
}

.perm-check {
  padding-right: 0.35rem;
}

.perm-help {
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.66rem;
  font-weight: 700;
  color: #67e8f9;
  border: 1px solid rgba(103, 232, 249, 0.45);
  background: rgba(14, 116, 144, 0.2);
  cursor: help;
  user-select: none;
}

.perm-tooltip {
  position: absolute;
  left: 0;
  top: calc(100% + 0.3rem);
  z-index: 20;
  min-width: 260px;
  max-width: 360px;
  padding: 0.45rem 0.55rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(100, 116, 139, 0.5);
  background: rgba(2, 6, 23, 0.97);
  color: #cbd5e1;
  font-size: 0.72rem;
  line-height: 1.35;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.perm-check:hover .perm-tooltip,
.perm-help:focus + .perm-tooltip {
  opacity: 1;
  transform: translateY(0);
}
.actions {
  margin-top: 0.8rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
}
.btn-ghost {
  border: 1px solid rgba(148, 163, 184, 0.4);
  background: rgba(15, 23, 42, 0.4);
  color: #e2e8f0;
  border-radius: 0.6rem;
  padding: 0.45rem 0.7rem;
  font-size: 0.78rem;
}
.btn-primary {
  border-radius: 0.6rem;
  padding: 0.45rem 0.8rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: #082f49;
  background: linear-gradient(180deg, rgba(34, 211, 238, 0.95), rgba(8, 145, 178, 0.95));
}
@media (min-width: 1000px) {
  .split {
    grid-template-columns: 1.15fr 1fr;
  }
  .permission-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
