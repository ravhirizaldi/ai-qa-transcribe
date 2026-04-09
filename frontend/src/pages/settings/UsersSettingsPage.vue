<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { toast } from "vue-sonner";
import {
  changeSettingsUserPassword,
  createSettingsUser,
  deleteSettingsUser,
  getAuthMeCached,
  listAccessRoles,
  listProjects,
  listSettingsUsers,
  listTenants,
  updateSettingsUser,
  updateSettingsUserAccess,
  type AccessRole,
  type Project,
  type SettingsUser,
  type Tenant,
} from "../../services/backendApi";

type DraftAssignment = {
  roleId: string;
  includeAllTenants: boolean;
  includeAllProjects: boolean;
  tenantIds: string[];
  projectIds: string[];
};

const users = ref<SettingsUser[]>([]);
const roles = ref<AccessRole[]>([]);
const tenants = ref<Tenant[]>([]);
const projectsByTenant = ref<Record<string, Project[]>>({});
const loading = ref(false);
const saving = ref(false);
const savingUser = ref(false);
const canManageSuperAdmins = ref(false);

const showCreateModal = ref(false);
const showEditorModal = ref(false);
const showDeleteConfirm = ref(false);

const createUserForm = ref({
  fullname: "",
  email: "",
  password: "",
  isRestricted: true,
});
const editFullname = ref("");
const editEmail = ref("");
const newPassword = ref("");

const selectedUserId = ref("");
const form = ref({
  isRestricted: true,
  assignments: [] as DraftAssignment[],
});

const pageSize = 8;
const currentPage = ref(1);

const sortedUsers = computed(() =>
  [...users.value].sort((a, b) => a.email.localeCompare(b.email)),
);
const totalPages = computed(() => Math.max(1, Math.ceil(sortedUsers.value.length / pageSize)));
const pagedUsers = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return sortedUsers.value.slice(start, start + pageSize);
});
const pageNumbers = computed(() => Array.from({ length: totalPages.value }, (_, i) => i + 1));

const selectedUser = computed(() => users.value.find((user) => user.id === selectedUserId.value) || null);

watch(
  () => sortedUsers.value.length,
  () => {
    if (currentPage.value > totalPages.value) currentPage.value = totalPages.value;
  },
);

const projectUsersCountById = computed(() => {
  const counts: Record<string, number> = {};

  for (const user of users.value) {
    for (const assignment of user.assignments) {
      for (const projectId of assignment.scope.projectIds) {
        counts[projectId] = (counts[projectId] || 0) + 1;
      }
    }
  }

  return counts;
});

const addAssignment = () => {
  form.value.assignments.push({
    roleId: roles.value[0]?.id || "",
    includeAllTenants: false,
    includeAllProjects: false,
    tenantIds: [],
    projectIds: [],
  });
};

const removeAssignment = (idx: number) => {
  form.value.assignments.splice(idx, 1);
};

const onPickUser = (user: SettingsUser) => {
  const allTenantIds = tenants.value.map((tenant) => tenant.id);
  const allProjectIds = Object.values(projectsByTenant.value)
    .flat()
    .map((project) => project.id);

  selectedUserId.value = user.id;
  editFullname.value = user.fullname;
  editEmail.value = user.email;
  newPassword.value = "";
  form.value = {
    isRestricted: user.isRestricted,
    assignments: user.assignments.map((assignment) => ({
      roleId: assignment.roleId,
      includeAllTenants: false,
      includeAllProjects: false,
      tenantIds: assignment.scope.includeAllTenants
        ? [...allTenantIds]
        : [...assignment.scope.tenantIds],
      projectIds: assignment.scope.includeAllProjects
        ? [...allProjectIds]
        : [...assignment.scope.projectIds],
    })),
  };
};

const openCreateModal = () => {
  createUserForm.value = {
    fullname: "",
    email: "",
    password: "",
    isRestricted: true,
  };
  showCreateModal.value = true;
};

const openEditorModal = (user: SettingsUser) => {
  onPickUser(user);
  showEditorModal.value = true;
};

const openDeleteConfirm = () => {
  if (!selectedUser.value) return;
  showDeleteConfirm.value = true;
};

const closeDeleteConfirm = () => {
  if (savingUser.value) return;
  showDeleteConfirm.value = false;
};

const createUser = async () => {
  if (!createUserForm.value.email.trim()) {
    toast.error("Email is required");
    return;
  }
  if (createUserForm.value.password.length < 8) {
    toast.error("Password must be at least 8 characters");
    return;
  }

  savingUser.value = true;
  try {
    const created = await createSettingsUser({
      email: createUserForm.value.email.trim(),
      fullname: createUserForm.value.fullname.trim() || undefined,
      password: createUserForm.value.password,
      isRestricted: createUserForm.value.isRestricted,
    });
    toast.success("User created");
    showCreateModal.value = false;
    await load(created.id);
    const selected = users.value.find((user) => user.id === created.id);
    if (selected) {
      openEditorModal(selected);
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to create user");
  } finally {
    savingUser.value = false;
  }
};

const removeUser = async () => {
  if (!selectedUser.value) return;

  savingUser.value = true;
  try {
    await deleteSettingsUser(selectedUser.value.id);
    toast.success("User deleted");
    showDeleteConfirm.value = false;
    showEditorModal.value = false;
    selectedUserId.value = "";
    await load();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to delete user");
  } finally {
    savingUser.value = false;
  }
};

const toggleFromList = (list: string[], value: string) => {
  const set = new Set(list);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return [...set];
};

const getProjectIdsFromTenantIds = (tenantIds: string[]) => {
  const allowed = new Set<string>();
  for (const tenantId of tenantIds) {
    for (const project of projectsByTenant.value[tenantId] || []) {
      allowed.add(project.id);
    }
  }
  return allowed;
};

const toggleTenantForAssignment = (assignment: DraftAssignment, tenantId: string) => {
  assignment.tenantIds = toggleFromList(assignment.tenantIds, tenantId);
  const allowedProjectIds = getProjectIdsFromTenantIds(assignment.tenantIds);
  assignment.projectIds = assignment.projectIds.filter((projectId) => allowedProjectIds.has(projectId));
};

const getProjectOptionsForAssignment = (assignment: DraftAssignment) => {
  if (assignment.tenantIds.length === 0) {
    return [];
  }

  const tenantIds = new Set(assignment.tenantIds);

  const baseProjects = Object.values(projectsByTenant.value)
    .flat()
    .filter((project) => tenantIds.has(project.tenantId));

  const selectedProjects = Object.values(projectsByTenant.value)
    .flat()
    .filter((project) => assignment.projectIds.includes(project.id));

  const merged = [...baseProjects];
  for (const project of selectedProjects) {
    if (!merged.some((item) => item.id === project.id)) merged.push(project);
  }

  return merged
    .map((project) => {
      const tenantName = tenants.value.find((tenant) => tenant.id === project.tenantId)?.name || "Unknown";
      const count = projectUsersCountById.value[project.id] || 0;
      return { id: project.id, label: `${tenantName} - ${project.name} (${count} Users)` };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
};

const normalizeAccessAssignments = (assignments: DraftAssignment[]) =>
  assignments
    .map((assignment) => ({
      roleId: assignment.roleId,
      includeAllTenants: false,
      includeAllProjects: false,
      tenantIds: [...assignment.tenantIds].sort(),
      projectIds: [...assignment.projectIds].sort(),
    }))
    .sort((a, b) => {
      const left = `${a.roleId}:${a.includeAllTenants}:${a.includeAllProjects}:${a.tenantIds.join(",")}:${a.projectIds.join(",")}`;
      const right = `${b.roleId}:${b.includeAllTenants}:${b.includeAllProjects}:${b.tenantIds.join(",")}:${b.projectIds.join(",")}`;
      return left.localeCompare(right);
    });

const currentUserAccessAssignments = (user: SettingsUser) =>
  normalizeAccessAssignments(
    user.assignments.map((assignment) => ({
      roleId: assignment.roleId,
      includeAllTenants: false,
      includeAllProjects: false,
      tenantIds: assignment.scope.tenantIds,
      projectIds: assignment.scope.projectIds,
    })),
  );

const load = async (preferredUserId?: string) => {
  loading.value = true;
  try {
    const [usersResult, rolesResult, tenantsResult] = await Promise.allSettled([
      listSettingsUsers(),
      listAccessRoles(),
      listTenants(),
    ]);

    if (usersResult.status !== "fulfilled") {
      throw usersResult.reason;
    }

    const usersData = usersResult.value;
    const rolesData = rolesResult.status === "fulfilled" ? rolesResult.value : [];
    const tenantsData = tenantsResult.status === "fulfilled" ? tenantsResult.value : [];
    const me = await getAuthMeCached();

    users.value = usersData;
    roles.value = rolesData;
    tenants.value = tenantsData;
    canManageSuperAdmins.value = !me.isRestricted;

    if (rolesResult.status !== "fulfilled") {
      toast.error(
        rolesResult.reason instanceof Error
          ? rolesResult.reason.message
          : "Failed to load role options",
      );
    }
    if (tenantsResult.status !== "fulfilled") {
      toast.error(
        tenantsResult.reason instanceof Error
          ? tenantsResult.reason.message
          : "Failed to load tenant options",
      );
    }

    const projectResults = await Promise.allSettled(
      tenantsData.map(async (tenant) => ({
        tenantId: tenant.id,
        projects: await listProjects(tenant.id),
      })),
    );
    const next: Record<string, Project[]> = {};
    for (const result of projectResults) {
      if (result.status === "fulfilled") next[result.value.tenantId] = result.value.projects;
    }
    projectsByTenant.value = next;

    const targetId = preferredUserId || selectedUserId.value;
    if (targetId) {
      const target = usersData.find((user) => user.id === targetId);
      if (target) onPickUser(target);
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to load users settings");
  } finally {
    loading.value = false;
  }
};

const save = async () => {
  if (!selectedUser.value) return;
  const email = editEmail.value.trim();
  const fullname = editFullname.value.trim();
  const password = newPassword.value.trim();

  if (!email) {
    toast.error("Email is required");
    return;
  }
  if (form.value.isRestricted && form.value.assignments.some((assignment) => !assignment.roleId)) {
    toast.error("Each assignment needs a role");
    return;
  }
  if (password && password.length < 8) {
    toast.error("New password must be at least 8 characters");
    return;
  }

  const user = selectedUser.value;
  const hasProfileChange =
    email !== user.email ||
    fullname !== user.fullname ||
    form.value.isRestricted !== user.isRestricted;
  const hasAccessChange =
    JSON.stringify(normalizeAccessAssignments(form.value.assignments)) !==
    JSON.stringify(currentUserAccessAssignments(user));
  const hasPasswordChange = Boolean(password);

  if (!hasProfileChange && !hasAccessChange && !hasPasswordChange) {
    toast.success("No changes to save");
    return;
  }

  saving.value = true;
  try {
    const tasks: Promise<unknown>[] = [];

    if (hasProfileChange) {
      tasks.push(
        updateSettingsUser(user.id, {
          email,
          fullname,
          isRestricted: form.value.isRestricted,
        }),
      );
    }

    if (hasAccessChange) {
      tasks.push(
        updateSettingsUserAccess(user.id, {
          isRestricted: form.value.isRestricted,
          assignments: form.value.assignments.map((assignment) => ({
            roleId: assignment.roleId,
            scope: {
              includeAllTenants: false,
              includeAllProjects: false,
              tenantIds: assignment.tenantIds,
              projectIds: assignment.projectIds,
            },
          })),
        }),
      );
    }

    if (hasPasswordChange) {
      tasks.push(changeSettingsUserPassword(user.id, password));
    }

    await Promise.all(tasks);
    newPassword.value = "";
    toast.success("User updated");
    await load(user.id);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to update user");
  } finally {
    saving.value = false;
  }
};

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="panel">
    <div class="header">
      <div>
        <p class="eyebrow">Users</p>
        <h2 class="title">User Management</h2>
      </div>
      <button class="btn-primary" @click="openCreateModal">Add User</button>
    </div>

    <div v-if="loading" class="muted">Loading users...</div>
    <div v-else>
      <div class="table-wrap">
        <table class="users-table">
          <thead>
            <tr>
              <th>Full Name</th>
              <th>Email</th>
              <th>Access</th>
              <th>Roles</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in pagedUsers" :key="user.id">
              <td>{{ user.fullname }}</td>
              <td>{{ user.email }}</td>
              <td>{{ user.isRestricted ? "Restricted" : "Super Admin" }}</td>
              <td>{{ user.assignments.length }}</td>
              <td class="align-right">
                <button class="btn-ghost" @click="openEditorModal(user)">Edit</button>
              </td>
            </tr>
            <tr v-if="!pagedUsers.length">
              <td colspan="5" class="muted">No users found.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="pagination">
        <button class="btn-ghost" :disabled="currentPage <= 1" @click="currentPage -= 1">Prev</button>
        <button
          v-for="page in pageNumbers"
          :key="page"
          class="page-btn"
          :class="{ active: currentPage === page }"
          @click="currentPage = page"
        >
          {{ page }}
        </button>
        <button class="btn-ghost" :disabled="currentPage >= totalPages" @click="currentPage += 1">
          Next
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="showCreateModal" class="overlay" @click.self="showCreateModal = false">
        <div class="modal-card">
          <div class="modal-header">
            <h3 class="subtitle">Add User</h3>
          </div>
          <div class="modal-body">
            <label class="label">Full Name</label>
            <input v-model="createUserForm.fullname" class="input" placeholder="User" />
            <label class="label">Email</label>
            <input v-model="createUserForm.email" class="input" placeholder="user@example.com" />
            <label class="label">Initial Password</label>
            <input v-model="createUserForm.password" type="password" class="input" />
            <label class="check-row">
              <input
                v-model="createUserForm.isRestricted"
                type="checkbox"
                :disabled="!canManageSuperAdmins"
              />
              <span>Restricted user</span>
            </label>
            <p v-if="!canManageSuperAdmins" class="muted tiny">
              Restricted admins can only create restricted users.
            </p>
          </div>
          <div class="actions modal-footer">
            <button class="btn-ghost" @click="showCreateModal = false">Cancel</button>
            <button class="btn-primary" :disabled="savingUser" @click="createUser">Create</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showEditorModal && selectedUser" class="overlay" @click.self="showEditorModal = false">
        <div class="modal-card large">
          <div class="modal-header row between">
            <h3 class="subtitle">Edit User</h3>
            <button class="btn-ghost" @click="showEditorModal = false">Close</button>
          </div>
          <div class="modal-body">
            <label class="label">Full Name</label>
            <input v-model="editFullname" class="input" placeholder="User" />
            <label class="label">Email</label>
            <input v-model="editEmail" class="input" placeholder="user@example.com" />

            <label class="check-row">
              <input
                v-model="form.isRestricted"
                type="checkbox"
                :disabled="!canManageSuperAdmins"
              />
              <span>Restricted user (enable role-based access)</span>
            </label>
            <p v-if="!canManageSuperAdmins" class="muted tiny">
              Restricted admins cannot promote users to super admin.
            </p>

            <div class="row between">
              <p class="label">Role Assignments</p>
              <button class="btn-ghost" @click="addAssignment">Add Role</button>
            </div>

            <div v-if="!form.assignments.length" class="muted tiny">
              No role assignments. If user is unrestricted, they can access everything.
            </div>

            <div v-for="(assignment, idx) in form.assignments" :key="idx" class="assignment-card">
              <div class="row between">
                <label class="label">Role</label>
                <button class="danger-link" @click="removeAssignment(idx)">Remove</button>
              </div>
              <select v-model="assignment.roleId" class="input">
                <option disabled value="">Select role</option>
                <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
              </select>

              <p class="label">Tenants scope</p>
              <div class="tag-list">
                <label v-for="tenant in tenants" :key="tenant.id" class="tag-check">
                  <input
                    type="checkbox"
                    :checked="assignment.tenantIds.includes(tenant.id)"
                    @change="toggleTenantForAssignment(assignment, tenant.id)"
                  />
                  <span>{{ tenant.name }}</span>
                </label>
              </div>

              <p class="label">Projects scope</p>
              <p v-if="assignment.tenantIds.length === 0" class="muted tiny">
                Select tenant scope first to load projects.
              </p>
              <div class="tag-list">
                <label
                  v-for="project in getProjectOptionsForAssignment(assignment)"
                  :key="project.id"
                  class="tag-check"
                >
                  <input
                    type="checkbox"
                    :checked="assignment.projectIds.includes(project.id)"
                    @change="assignment.projectIds = toggleFromList(assignment.projectIds, project.id)"
                  />
                  <span>{{ project.label }}</span>
                </label>
              </div>
            </div>

            <div class="assignment-card">
              <p class="label">Change Password</p>
              <input
                v-model="newPassword"
                type="password"
                class="input"
                placeholder="New password (min 8 chars)"
              />
            </div>
          </div>

          <div class="actions modal-footer">
            <button class="btn-primary" :disabled="saving" @click="save">
              {{ saving ? "Saving..." : "Save" }}
            </button>
            <button class="danger-btn" :disabled="savingUser" @click="openDeleteConfirm">
              Delete User
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="showDeleteConfirm && selectedUser"
        class="overlay"
        @click.self="closeDeleteConfirm"
      >
        <div class="modal-card">
          <div class="modal-header">
            <h3 class="subtitle">Delete User</h3>
          </div>
          <div class="modal-body">
            <p class="muted">
              Delete user "{{ selectedUser.email }}"? This action cannot be undone.
            </p>
          </div>
          <div class="actions modal-footer">
            <button class="btn-ghost" :disabled="savingUser" @click="closeDeleteConfirm">
              Cancel
            </button>
            <button class="danger-btn" :disabled="savingUser" @click="removeUser">
              {{ savingUser ? "Deleting..." : "Delete User" }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 1rem;
  padding: 1rem;
  background: rgba(2, 6, 23, 0.35);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.8rem;
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
.table-wrap {
  border: 1px solid rgba(100, 116, 139, 0.4);
  border-radius: 0.8rem;
  overflow: auto;
  background: rgba(15, 23, 42, 0.55);
}
.users-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.users-table th,
.users-table td {
  padding: 0.65rem 0.7rem;
  border-bottom: 1px solid rgba(100, 116, 139, 0.25);
  color: #cbd5e1;
  font-size: 0.82rem;
  text-align: left;
  vertical-align: middle;
  word-break: break-word;
}
.users-table th {
  color: #94a3b8;
  font-weight: 600;
  background: rgba(15, 23, 42, 0.8);
}
.users-table tbody tr:hover {
  background: rgba(30, 41, 59, 0.45);
}
.users-table th:nth-child(1),
.users-table td:nth-child(1) {
  width: 24%;
}
.users-table th:nth-child(2),
.users-table td:nth-child(2) {
  width: 32%;
}
.users-table th:nth-child(3),
.users-table td:nth-child(3) {
  width: 16%;
}
.users-table th:nth-child(4),
.users-table td:nth-child(4) {
  width: 8%;
}
.users-table th:nth-child(5),
.users-table td:nth-child(5) {
  width: 20%;
}
.align-right {
  text-align: right !important;
}
.pagination {
  margin-top: 0.75rem;
  display: flex;
  gap: 0.35rem;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
}
.page-btn {
  border: 1px solid rgba(148, 163, 184, 0.4);
  background: rgba(15, 23, 42, 0.4);
  color: #e2e8f0;
  border-radius: 0.5rem;
  padding: 0.25rem 0.55rem;
  font-size: 0.76rem;
}
.page-btn.active {
  color: #082f49;
  border-color: transparent;
  background: linear-gradient(180deg, rgba(34, 211, 238, 0.95), rgba(8, 145, 178, 0.95));
}
.overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(2, 6, 23, 0.86);
  backdrop-filter: blur(6px);
  display: grid;
  place-items: center;
  padding: 4.5rem 1rem 1rem;
}
.modal-card {
  width: min(520px, 100%);
  max-height: calc(100vh - 5.5rem);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-radius: 1rem;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(15, 23, 42, 0.98);
  padding: 0.9rem;
}
.modal-card.large {
  width: min(900px, 100%);
}
.modal-header {
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgba(15, 23, 42, 0.98);
  padding-bottom: 0.45rem;
}
.modal-body {
  overflow: auto;
  min-height: 0;
  padding-right: 0.15rem;
}
.modal-footer {
  position: sticky;
  bottom: 0;
  z-index: 1;
  background: rgba(15, 23, 42, 0.98);
  padding-top: 0.45rem;
  border-top: 1px solid rgba(100, 116, 139, 0.25);
}
.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.between {
  justify-content: space-between;
}
.switch-row,
.check-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: #cbd5e1;
  font-size: 0.82rem;
  margin-top: 0.55rem;
}
.label {
  color: #cbd5e1;
  font-size: 0.78rem;
  margin-top: 0.55rem;
}
.input {
  width: 100%;
  margin-top: 0.25rem;
  border-radius: 0.6rem;
  border: 1px solid rgba(100, 116, 139, 0.55);
  background: rgba(15, 23, 42, 0.6);
  color: #e2e8f0;
  padding: 0.45rem 0.62rem;
  font-size: 0.82rem;
}
.assignment-card {
  margin-top: 0.6rem;
  border: 1px solid rgba(100, 116, 139, 0.35);
  border-radius: 0.7rem;
  padding: 0.6rem;
}
.checks {
  display: flex;
  gap: 0.9rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.35rem;
}
.tag-check {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid rgba(100, 116, 139, 0.4);
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  color: #cbd5e1;
  font-size: 0.74rem;
}
.muted {
  color: #94a3b8;
}
.tiny {
  font-size: 0.72rem;
}
.actions {
  margin-top: 0.65rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 0.35rem;
}
.btn-ghost {
  border: 1px solid rgba(148, 163, 184, 0.4);
  background: rgba(15, 23, 42, 0.4);
  color: #e2e8f0;
  border-radius: 0.6rem;
  padding: 0.3rem 0.62rem;
  font-size: 0.75rem;
}
.btn-primary {
  border-radius: 0.6rem;
  padding: 0.35rem 0.72rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: #082f49;
  background: linear-gradient(180deg, rgba(34, 211, 238, 0.95), rgba(8, 145, 178, 0.95));
}
.danger-btn {
  border: 1px solid rgba(239, 68, 68, 0.65);
  background: rgba(127, 29, 29, 0.45);
  color: #fecaca;
  border-radius: 0.6rem;
  padding: 0.35rem 0.72rem;
  font-size: 0.78rem;
}
.danger-link {
  color: #fca5a5;
  font-size: 0.75rem;
}
</style>
