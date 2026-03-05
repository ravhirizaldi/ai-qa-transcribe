<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { Image as ImageIcon, MoreVertical } from "lucide-vue-next";
import {
  activateMatrixVersion,
  createMatrixVersion,
  createProject,
  createTenant,
  deleteMatrixVersion,
  deleteProject,
  deleteTenant,
  getMatrixVersion,
  listMatrixVersions,
  listProjects,
  listTenants,
  updateProject,
  updateTenant,
  uploadImage,
  type MatrixCallType,
  type MatrixRow,
  type MatrixVersion,
  type Project,
  type Tenant,
} from "../services/backendApi";
import { useSession } from "../services/session";

const session = useSession();
const { setTenantId, setProjectId } = session;
const route = useRoute();
const router = useRouter();

const tenants = ref<Tenant[]>([]);
const projectsByTenant = ref<Record<string, Project[]>>({});
const loading = ref(false);
const errorMessage = ref("");

const showTenantModal = ref(false);
const tenantForm = ref({ name: "", logoUrl: "" });
const creatingTenant = ref(false);
const uploadingTenantLogo = ref(false);

const showProjectModal = ref(false);
const projectForm = ref({
  tenantId: "",
  name: "",
  logoUrl: "",
  callType: "inbound" as MatrixCallType,
  batchHistoryLockDays: 2,
  ceScoringPolicy:
    "strict_zero_all_ce_if_any_fail" as
      | "strict_zero_all_ce_if_any_fail"
      | "weighted_ce_independent",
});
const projectModalTenantLocked = ref(false);
const creatingProject = ref(false);
const uploadingProjectLogo = ref(false);

const showEditTenantModal = ref(false);
const editTenantForm = ref({ id: "", name: "", logoUrl: "" });
const savingTenantEdit = ref(false);
const uploadingEditTenantLogo = ref(false);

const showEditProjectModal = ref(false);
const editProjectForm = ref({
  tenantId: "",
  id: "",
  name: "",
  logoUrl: "",
  batchHistoryLockDays: 2,
  ceScoringPolicy:
    "strict_zero_all_ce_if_any_fail" as
      | "strict_zero_all_ce_if_any_fail"
      | "weighted_ce_independent",
});
const savingProjectEdit = ref(false);
const uploadingEditProjectLogo = ref(false);

const showConfirmModal = ref(false);
const confirmTitle = ref("");
const confirmMessage = ref("");
const confirmBusy = ref(false);
let confirmAction: null | (() => Promise<void>) = null;
const syncingRoute = ref(false);

const normalizeUuidParam = (value: unknown) => {
  if (typeof value !== "string") return "";
  const match = value
    .toLowerCase()
    .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  return match ? match[0] : "";
};

const showWorkspaceModal = ref(false);
const workspaceTenantId = ref("");
const workspaceProjectId = ref("");

const matrixCallType = ref<MatrixCallType>("inbound");
const matrixVersions = ref<MatrixVersion[]>([]);
const selectedMatrixVersionId = ref("");
const matrixRowsDraft = ref<MatrixRow[]>([]);
const matrixLoading = ref(false);
const matrixBusy = ref(false);
const matrixError = ref("");
const matrixDirty = ref(false); // true when rows have unsaved changes
const conditionEditIdx = ref<number | null>(null); // row index being edited in the condition modal
const openMenuId = ref<string | null>(null); // tracks which version row's 3-dot menu is open
const conditionRow = computed(() =>
  conditionEditIdx.value !== null
    ? (matrixRowsDraft.value[conditionEditIdx.value] ?? null)
    : null,
);

const workspaceTenant = computed(
  () =>
    tenants.value.find((tenant) => tenant.id === workspaceTenantId.value) ||
    null,
);
const workspaceProjects = computed(
  () => projectsByTenant.value[workspaceTenantId.value] || [],
);
const activeProject = computed(
  () =>
    workspaceProjects.value.find(
      (project) => project.id === workspaceProjectId.value,
    ) || null,
);
// removed selectedMatrixVersion computed as it's no longer used
const canUseInboundMatrix = computed(() =>
  Boolean(activeProject.value?.supportsInbound),
);
const canUseOutboundMatrix = computed(() =>
  Boolean(activeProject.value?.supportsOutbound),
);

const jsonFileInput = ref<HTMLInputElement | null>(null);

const triggerJsonUpload = () => {
  jsonFileInput.value?.click();
};

const handleJsonUpload = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (!target.files?.length) return;

  const file = target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;
      const parsed = JSON.parse(content);

      if (!Array.isArray(parsed)) {
        toast.error("Invalid JSON: Expected an array of objects");
        return;
      }

      const newRows = parsed.map((item: any) => ({
        area: String(item.area || ""),
        parameter:
          String(item.parameter || "NCE").toUpperCase() === "CE" ? "CE" : "NCE",
        description: String(item.description || ""),
        weight: Math.floor(Number(item.weight || 1)),
      }));

      if (newRows.length > 0) {
        requestConfirm(
          "Overwrite Matrix Rows?",
          "Uploading a JSON will replace all current evaluation parameters. This action cannot be undone. Continue?",
          async () => {
            matrixRowsDraft.value = newRows as any;
            toast.success(
              `Successfully loaded ${newRows.length} matrix parameters`,
            );
          },
        );
      } else {
        toast.error("JSON array was empty");
      }
    } catch (error) {
      toast.error("Failed to parse JSON file");
    } finally {
      if (target) target.value = "";
    }
  };
  reader.readAsText(file);
};

const resetMatrixDraft = () => {
  matrixRowsDraft.value = [
    { area: "", parameter: "NCE", description: "", weight: 1 },
  ];
};

const ensureMatrixCallType = () => {
  if (
    matrixCallType.value === "inbound" &&
    !canUseInboundMatrix.value &&
    canUseOutboundMatrix.value
  ) {
    matrixCallType.value = "outbound";
    return;
  }
  if (
    matrixCallType.value === "outbound" &&
    !canUseOutboundMatrix.value &&
    canUseInboundMatrix.value
  ) {
    matrixCallType.value = "inbound";
  }
};

const loadTenants = async () => {
  loading.value = true;
  errorMessage.value = "";
  try {
    tenants.value = await listTenants();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to load tenants";
    toast.error("Failed to load tenants");
  } finally {
    loading.value = false;
  }
};

const loadProjectsForTenant = async (tenantId: string) => {
  try {
    const projects = await listProjects(tenantId);
    // Write individually so single-tenant loads are still correct
    projectsByTenant.value = {
      ...projectsByTenant.value,
      [tenantId]: projects,
    };
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to load projects";
    toast.error("Failed to load projects");
  }
};

const refreshAll = async () => {
  await loadTenants();
  // Fetch all tenant projects in parallel, then write all at once to avoid
  // concurrent spread-overwrites that made some tenants show 0 projects.
  const results = await Promise.allSettled(
    tenants.value.map(async (tenant) => ({
      id: tenant.id,
      projects: await listProjects(tenant.id),
    })),
  );
  const merged: Record<string, Project[]> = { ...projectsByTenant.value };
  for (const result of results) {
    if (result.status === "fulfilled") {
      merged[result.value.id] = result.value.projects;
    }
  }
  projectsByTenant.value = merged;
};

const openTenantModal = () => {
  tenantForm.value = { name: "", logoUrl: "" };
  showTenantModal.value = true;
};

const handleCreateTenantLogoUpload = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  uploadingTenantLogo.value = true;
  try {
    const { path } = await uploadImage(file);
    tenantForm.value.logoUrl = path;
    toast.success("Tenant logo uploaded");
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to upload tenant logo",
    );
  } finally {
    uploadingTenantLogo.value = false;
    target.value = "";
  }
};

const createTenantAction = async () => {
  if (!tenantForm.value.name.trim()) {
    toast.error("Tenant name is required");
    return;
  }

  creatingTenant.value = true;
  try {
    const tenant = await createTenant({
      name: tenantForm.value.name.trim(),
      logoUrl: tenantForm.value.logoUrl.trim() || null,
    });
    tenants.value = [...tenants.value, tenant];
    projectsByTenant.value = { ...projectsByTenant.value, [tenant.id]: [] };
    showTenantModal.value = false;
    toast.success("Tenant created");
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to create tenant",
    );
  } finally {
    creatingTenant.value = false;
  }
};

const openProjectModal = (tenantId?: string) => {
  projectModalTenantLocked.value = Boolean(tenantId);
  projectForm.value = {
    tenantId: tenantId || workspaceTenantId.value || tenants.value[0]?.id || "",
    name: "",
    logoUrl: "",
    callType: "inbound",
    batchHistoryLockDays: 2,
    ceScoringPolicy: "strict_zero_all_ce_if_any_fail",
  };
  showProjectModal.value = true;
};

const handleCreateProjectLogoUpload = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  uploadingProjectLogo.value = true;
  try {
    const { path } = await uploadImage(file);
    projectForm.value.logoUrl = path;
    toast.success("Project logo uploaded");
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to upload project logo",
    );
  } finally {
    uploadingProjectLogo.value = false;
    target.value = "";
  }
};

const createProjectAction = async () => {
  if (!projectForm.value.tenantId) {
    toast.error("Select tenant first");
    return;
  }
  if (!projectForm.value.name.trim()) {
    toast.error("Project name is required");
    return;
  }
  if (projectForm.value.batchHistoryLockDays < 1) {
    toast.error("Batch lock days must be at least 1 day");
    return;
  }

  creatingProject.value = true;
  try {
    const project = await createProject(projectForm.value.tenantId, {
      name: projectForm.value.name.trim(),
      logoUrl: projectForm.value.logoUrl.trim() || null,
      supportsInbound: projectForm.value.callType === "inbound",
      supportsOutbound: projectForm.value.callType === "outbound",
      batchHistoryLockDays: Math.floor(projectForm.value.batchHistoryLockDays),
      ceScoringPolicy: projectForm.value.ceScoringPolicy,
    });
    projectsByTenant.value = {
      ...projectsByTenant.value,
      [projectForm.value.tenantId]: [
        ...(projectsByTenant.value[projectForm.value.tenantId] || []),
        project,
      ],
    };

    if (workspaceTenantId.value === projectForm.value.tenantId) {
      workspaceProjectId.value = project.id;
      await syncUrlWithWorkspace();
    }

    showProjectModal.value = false;
    toast.success("Project created");
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to create project",
    );
  } finally {
    creatingProject.value = false;
  }
};

const openTenantWorkspace = async (tenant: Tenant) => {
  workspaceTenantId.value = tenant.id;
  setTenantId(tenant.id);
  showWorkspaceModal.value = true;

  if (!projectsByTenant.value[tenant.id]) {
    await loadProjectsForTenant(tenant.id);
  }

  const list = projectsByTenant.value[tenant.id] || [];
  workspaceProjectId.value = list[0]?.id || "";
  setProjectId(workspaceProjectId.value);
  await syncUrlWithWorkspace();
};

const closeWorkspaceModal = () => {
  showWorkspaceModal.value = false;
  matrixError.value = "";
  void clearWorkspaceParams();
};

const selectWorkspaceProject = (projectId: string) => {
  workspaceProjectId.value = projectId;
  setTenantId(workspaceTenantId.value);
  setProjectId(projectId);
  void syncUrlWithWorkspace();
};

const syncUrlWithWorkspace = async () => {
  syncingRoute.value = true;
  await router.replace({
    path: "/manage",
    query: {
      tenant: workspaceTenantId.value || undefined,
      project: workspaceProjectId.value || undefined,
    },
  });
  syncingRoute.value = false;
};

const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001"
).replace(/\/$/, "");
const logoBgColors = ref<Record<string, string>>({});

const resolveProjectLogoUrl = (logoUrl?: string | null) => {
  if (!logoUrl) return "";
  if (logoUrl.startsWith("http://") || logoUrl.startsWith("https://")) {
    return logoUrl;
  }
  return `${apiBaseUrl}${logoUrl.startsWith("/") ? logoUrl : `/${logoUrl}`}`;
};

const resolveTenantLogoUrl = (logoUrl?: string | null) =>
  resolveProjectLogoUrl(logoUrl);

const getLogoBgStyle = (src: string) => ({
  backgroundColor: logoBgColors.value[src] || "rgba(2, 6, 23, 0.65)",
});

const applyDominantLogoColor = (event: Event) => {
  const img = event.target as HTMLImageElement;
  const src = img.currentSrc || img.src;
  if (!src || logoBgColors.value[src]) return;

  try {
    const canvas = document.createElement("canvas");
    const size = 24;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 40) continue;
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
      count += 1;
    }
    if (!count) return;

    const r = Math.round(rSum / count);
    const g = Math.round(gSum / count);
    const b = Math.round(bSum / count);
    logoBgColors.value[src] = `rgba(${r}, ${g}, ${b}, 0.3)`;
  } catch {
    // Ignore extraction errors (for example, tainted canvas).
  }
};

const clearWorkspaceParams = async () => {
  syncingRoute.value = true;
  await router.replace({ path: "/manage", query: {} });
  syncingRoute.value = false;
};

const openWorkspaceById = async (
  tenantId: string,
  preferredProjectId?: string,
) => {
  const tenant = tenants.value.find((item) => item.id === tenantId);
  if (!tenant) return;

  workspaceTenantId.value = tenant.id;
  setTenantId(tenant.id);
  showWorkspaceModal.value = true;

  if (!projectsByTenant.value[tenant.id]) {
    await loadProjectsForTenant(tenant.id);
  }

  const list = projectsByTenant.value[tenant.id] || [];
  const selectedProject = list.find(
    (project) => project.id === preferredProjectId,
  );
  workspaceProjectId.value = selectedProject?.id || list[0]?.id || "";
  setProjectId(workspaceProjectId.value);
};

const openEditTenantModal = (tenant: Tenant) => {
  editTenantForm.value = {
    id: tenant.id,
    name: tenant.name,
    logoUrl: tenant.logoUrl || "",
  };
  showEditTenantModal.value = true;
};

const handleEditTenantLogoUpload = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  uploadingEditTenantLogo.value = true;
  try {
    const { path } = await uploadImage(file);
    editTenantForm.value.logoUrl = path;
    toast.success("Tenant logo uploaded");
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to upload tenant logo",
    );
  } finally {
    uploadingEditTenantLogo.value = false;
    target.value = "";
  }
};

const saveTenantEdit = async () => {
  if (!editTenantForm.value.id) return;
  if (!editTenantForm.value.name.trim()) {
    toast.error("Tenant name is required");
    return;
  }
  savingTenantEdit.value = true;
  try {
    const updated = await updateTenant(editTenantForm.value.id, {
      name: editTenantForm.value.name.trim(),
      logoUrl: editTenantForm.value.logoUrl.trim() || null,
    });
    tenants.value = tenants.value.map((item) =>
      item.id === updated.id ? updated : item,
    );
    showEditTenantModal.value = false;
    toast.success("Tenant updated");
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to update tenant",
    );
  } finally {
    savingTenantEdit.value = false;
  }
};

const requestConfirm = (
  title: string,
  message: string,
  action: () => Promise<void>,
) => {
  confirmTitle.value = title;
  confirmMessage.value = message;
  confirmAction = action;
  showConfirmModal.value = true;
};

const runConfirmAction = async () => {
  if (!confirmAction) return;
  confirmBusy.value = true;
  try {
    await confirmAction();
    showConfirmModal.value = false;
    confirmAction = null;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Action failed");
  } finally {
    confirmBusy.value = false;
  }
};

const closeConfirmModal = () => {
  showConfirmModal.value = false;
  confirmAction = null;
};

const deleteTenantAction = async (tenant: Tenant) => {
  requestConfirm(
    "Delete Tenant",
    `Delete tenant ${tenant.name}? This removes all projects and jobs.`,
    async () => {
      await deleteTenant(tenant.id);
      tenants.value = tenants.value.filter((item) => item.id !== tenant.id);
      const next = { ...projectsByTenant.value };
      delete next[tenant.id];
      projectsByTenant.value = next;

      if (workspaceTenantId.value === tenant.id) {
        closeWorkspaceModal();
      }

      toast.success("Tenant deleted");
    },
  );
};

const openEditProjectModal = (project: Project) => {
  editProjectForm.value = {
    tenantId: project.tenantId,
    id: project.id,
    name: project.name,
    logoUrl: project.logoUrl || "",
    batchHistoryLockDays: project.batchHistoryLockDays || 2,
    ceScoringPolicy:
      project.ceScoringPolicy || "strict_zero_all_ce_if_any_fail",
  };
  showEditProjectModal.value = true;
};

const handleEditProjectLogoUpload = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  uploadingEditProjectLogo.value = true;
  try {
    const { path } = await uploadImage(file);
    editProjectForm.value.logoUrl = path;
    toast.success("Project logo uploaded");
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to upload project logo",
    );
  } finally {
    uploadingEditProjectLogo.value = false;
    target.value = "";
  }
};

const saveProjectEdit = async () => {
  if (!editProjectForm.value.id || !editProjectForm.value.tenantId) return;
  if (!editProjectForm.value.name.trim()) {
    toast.error("Project name is required");
    return;
  }
  if (editProjectForm.value.batchHistoryLockDays < 1) {
    toast.error("Batch lock days must be at least 1 day");
    return;
  }
  savingProjectEdit.value = true;
  try {
    const updated = await updateProject(
      editProjectForm.value.tenantId,
      editProjectForm.value.id,
      {
        name: editProjectForm.value.name.trim(),
        logoUrl: editProjectForm.value.logoUrl.trim() || null,
        batchHistoryLockDays: Math.floor(editProjectForm.value.batchHistoryLockDays),
        ceScoringPolicy: editProjectForm.value.ceScoringPolicy,
      },
    );
    projectsByTenant.value = {
      ...projectsByTenant.value,
      [updated.tenantId]: (projectsByTenant.value[updated.tenantId] || []).map(
        (item) => (item.id === updated.id ? updated : item),
      ),
    };
    showEditProjectModal.value = false;
    toast.success("Project updated");
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to update project",
    );
  } finally {
    savingProjectEdit.value = false;
  }
};

const deleteProjectAction = async (project: Project) => {
  requestConfirm(
    "Delete Project",
    `Delete project ${project.name}? This removes jobs and matrix versions.`,
    async () => {
      await deleteProject(project.tenantId, project.id);
      const nextProjects = (
        projectsByTenant.value[project.tenantId] || []
      ).filter((item) => item.id !== project.id);
      projectsByTenant.value = {
        ...projectsByTenant.value,
        [project.tenantId]: nextProjects,
      };

      if (workspaceProjectId.value === project.id) {
        workspaceProjectId.value = nextProjects[0]?.id || "";
        setProjectId(workspaceProjectId.value);
        await syncUrlWithWorkspace();
      }

      toast.success("Project deleted");
    },
  );
};

const loadMatrixVersions = async () => {
  matrixError.value = "";
  matrixVersions.value = [];
  selectedMatrixVersionId.value = "";

  if (!activeProject.value) {
    resetMatrixDraft();
    return;
  }

  ensureMatrixCallType();
  if (
    (matrixCallType.value === "inbound" && !canUseInboundMatrix.value) ||
    (matrixCallType.value === "outbound" && !canUseOutboundMatrix.value)
  ) {
    resetMatrixDraft();
    return;
  }

  matrixLoading.value = true;
  try {
    matrixVersions.value = await listMatrixVersions(
      activeProject.value.id,
      matrixCallType.value,
    );
    const active = matrixVersions.value.find((version) => version.isActive);

    if (!active) {
      resetMatrixDraft();
      return;
    }

    selectedMatrixVersionId.value = active.id;
    const detail = await getMatrixVersion(
      activeProject.value.id,
      matrixCallType.value,
      active.id,
    );
    matrixRowsDraft.value = detail.rows.map((row) => ({
      area: row.area,
      parameter: row.parameter,
      description: row.description,
      weight: row.weight,
    }));
    matrixDirty.value = false; // loaded from server — not an unsaved change
  } catch (error) {
    matrixError.value =
      error instanceof Error ? error.message : "Failed to load matrix versions";
    resetMatrixDraft();
  } finally {
    matrixLoading.value = false;
    matrixDirty.value = false; // ensure clean state after any load outcome
  }
};

const selectMatrixVersionAction = async (versionId: string) => {
  if (!activeProject.value || !versionId) return;

  matrixBusy.value = true;
  try {
    const detail = await getMatrixVersion(
      activeProject.value.id,
      matrixCallType.value,
      versionId,
    );
    selectedMatrixVersionId.value = detail.id;
    matrixRowsDraft.value = detail.rows.map((row) => ({
      area: row.area,
      parameter: row.parameter,
      description: row.description,
      weight: row.weight,
    }));
  } catch (error) {
    matrixError.value =
      error instanceof Error ? error.message : "Failed to load matrix version";
  } finally {
    matrixBusy.value = false;
  }
};

const addMatrixRow = () => {
  matrixRowsDraft.value = [
    ...matrixRowsDraft.value,
    { area: "", parameter: "NCE", description: "", weight: 1 },
  ];
};

const removeMatrixRow = (idx: number) => {
  matrixRowsDraft.value = matrixRowsDraft.value.filter(
    (_, rowIndex) => rowIndex !== idx,
  );
  if (!matrixRowsDraft.value.length) resetMatrixDraft();
};

const normalizeRows = () =>
  matrixRowsDraft.value.map((row) => ({
    area: row.area.trim(),
    parameter: row.parameter.trim().toUpperCase(),
    description: row.description.trim(),
    weight: Math.floor(Number(row.weight || 0)),
  }));

const validateRows = (rows: MatrixRow[]) => {
  if (!rows.length) return "At least one row is required";
  for (const row of rows) {
    if (!row.area || !row.parameter || !row.description)
      return "All row fields are required";
    if (!Number.isInteger(row.weight) || row.weight <= 0)
      return "Weight must be a positive integer";
  }
  return "";
};

const createMatrixVersionAction = async () => {
  if (!activeProject.value) return;
  const rows = normalizeRows();
  const err = validateRows(rows);
  if (err) {
    toast.error(err);
    return;
  }

  matrixBusy.value = true;
  try {
    const created = await createMatrixVersion(
      activeProject.value.id,
      matrixCallType.value,
      rows,
    );
    toast.success(`Matrix version v${created.versionNumber} created`);
    await loadMatrixVersions();
    await selectMatrixVersionAction(created.id);
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : "Failed to create matrix version",
    );
  } finally {
    matrixBusy.value = false;
  }
};

// Removed updateMatrixVersionAction as Update is replaced by Save Draft

const activateMatrixVersionAction = async (versionId: string) => {
  if (!activeProject.value || !versionId) return;

  matrixBusy.value = true;
  try {
    await activateMatrixVersion(
      activeProject.value.id,
      matrixCallType.value,
      versionId,
    );
    toast.success("Version activated");
    await loadMatrixVersions();
    await selectMatrixVersionAction(versionId);
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to activate version",
    );
  } finally {
    matrixBusy.value = false;
  }
};

const deleteMatrixVersionAction = async (versionId: string) => {
  if (!activeProject.value || !versionId) return;
  const projectId = activeProject.value.id;
  requestConfirm(
    "Delete Matrix Version",
    "Delete this matrix version? Active version cannot be deleted.",
    async () => {
      matrixBusy.value = true;
      try {
        await deleteMatrixVersion(projectId, matrixCallType.value, versionId);
        toast.success("Version deleted");
        await loadMatrixVersions();
      } finally {
        matrixBusy.value = false;
      }
    },
  );
};

// Mark as dirty ONLY when user makes edits, not when data loads from the server.
// matrixLoading / matrixBusy act as a guard to prevent false dirty on initial load
// or when selecting a different version.
watch(
  matrixRowsDraft,
  () => {
    if (!matrixLoading.value && !matrixBusy.value) {
      matrixDirty.value = true;
    }
  },
  { deep: true },
);

const saveDraftAction = () => {
  if (!activeProject.value) return;
  const rows = normalizeRows();
  const err = validateRows(rows);
  if (err) {
    toast.error(err);
    return;
  }

  const activeVersion = matrixVersions.value.find((v) => v.isActive);
  const nextVersionNum = (activeVersion?.versionNumber ?? 0) + 1;
  const msg = activeVersion
    ? `This will create a new matrix version v${nextVersionNum} from your current edits. The new version won't be active until you activate it. Continue?`
    : "This will create the first matrix version from your current rows. Continue?";

  requestConfirm("Save as New Version", msg, async () => {
    matrixBusy.value = true;
    try {
      const created = await createMatrixVersion(
        activeProject.value!.id,
        matrixCallType.value,
        rows,
      );
      matrixDirty.value = false;
      toast.success(`Matrix version v${created.versionNumber} created`);
      await loadMatrixVersions();
      await selectMatrixVersionAction(created.id);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save matrix version",
      );
    } finally {
      matrixBusy.value = false;
    }
  });
};

watch([workspaceProjectId, matrixCallType], async () => {
  if (showWorkspaceModal.value) {
    await loadMatrixVersions();
  }
});

watch(
  () => route.query,
  async (query) => {
    if (syncingRoute.value) return;
    const tenantQuery = normalizeUuidParam(query.tenant);
    const projectQuery = normalizeUuidParam(query.project);

    if (!tenantQuery) {
      showWorkspaceModal.value = false;
      workspaceTenantId.value = "";
      workspaceProjectId.value = "";
      if (query.tenant || query.project) {
        await clearWorkspaceParams();
      }
      return;
    }

    await openWorkspaceById(tenantQuery, projectQuery || undefined);
  },
);

onMounted(async () => {
  await refreshAll();
  resetMatrixDraft();
  const tenantQuery = normalizeUuidParam(route.query.tenant);
  const projectQuery = normalizeUuidParam(route.query.project);
  if (tenantQuery) {
    await openWorkspaceById(tenantQuery, projectQuery || undefined);
  }

  // Close versions dropdown menu when clicking outside
  window.addEventListener("click", () => {
    openMenuId.value = null;
  });
});
</script>

<template>
  <section class="manage-shell">
    <header class="hero-card">
      <p class="hero-eyebrow">Workspace Control</p>
      <h2 class="hero-title">Tenants and Matrix Workspace</h2>
      <p class="hero-sub">
        Start by creating a tenant, click any tenant card to open its workspace,
        then add projects and build matrix versions in one focused screen.
      </p>

      <div class="hero-actions">
        <button class="cta-btn" @click="openTenantModal">+ Add Tenant</button>
      </div>
    </header>

    <p v-if="errorMessage" class="msg-error">{{ errorMessage }}</p>
    <p v-if="loading" class="msg-muted">Loading tenants...</p>

    <div class="tenant-grid">
      <article
        v-for="tenant in tenants"
        :key="tenant.id"
        class="tenant-card"
        @click="openTenantWorkspace(tenant)"
      >
        <div class="project-main">
          <div
            class="project-logo"
            :style="
              tenant.logoUrl
                ? getLogoBgStyle(resolveTenantLogoUrl(tenant.logoUrl))
                : undefined
            "
          >
            <img
              v-if="tenant.logoUrl"
              :src="resolveTenantLogoUrl(tenant.logoUrl)"
              :alt="`${tenant.name} logo`"
              crossorigin="anonymous"
              @load="applyDominantLogoColor"
            />
            <ImageIcon v-else class="w-4 h-4" />
          </div>
          <div>
            <p class="tenant-name">{{ tenant.name }}</p>
            <p class="tenant-meta">
              {{ (projectsByTenant[tenant.id] || []).length }} projects
            </p>
          </div>
        </div>
        <div class="tenant-card-actions" @click.stop>
          <button class="btn-ghost" @click="openEditTenantModal(tenant)">
            Edit
          </button>
          <button class="btn-danger" @click="deleteTenantAction(tenant)">
            Delete
          </button>
        </div>
      </article>
    </div>

    <div v-if="showTenantModal" class="overlay">
      <div class="modal-card">
        <h3 class="modal-title">Create Tenant</h3>
        <input
          v-model="tenantForm.name"
          class="input"
          placeholder="Tenant name"
        />
        <input
          v-model="tenantForm.logoUrl"
          class="input"
          placeholder="/uploads/images/tenant-logo.png"
        />
        <label class="btn-ghost btn-file">
          <input
            type="file"
            accept="image/*"
            :disabled="uploadingTenantLogo"
            @change="handleCreateTenantLogoUpload"
          />
          {{ uploadingTenantLogo ? "Uploading Logo..." : "Upload Logo" }}
        </label>
        <div class="modal-actions">
          <button class="btn-ghost" @click="showTenantModal = false">
            Cancel
          </button>
          <button
            class="btn-primary"
            :disabled="creatingTenant"
            @click="createTenantAction"
          >
            Create
          </button>
        </div>
      </div>
    </div>

    <div v-if="showProjectModal" class="overlay">
      <div class="modal-card">
        <h3 class="modal-title">Create Project</h3>
        <select
          v-model="projectForm.tenantId"
          class="input"
          :disabled="projectModalTenantLocked"
        >
          <option value="">Select tenant</option>
          <option v-for="tenant in tenants" :key="tenant.id" :value="tenant.id">
            {{ tenant.name }}
          </option>
        </select>
        <input
          v-model="projectForm.name"
          class="input"
          placeholder="Project name"
        />
        <div class="project-logo-field">
          <label class="msg-muted">Project logo</label>
          <div class="project-logo-input-row">
            <input
              v-model="projectForm.logoUrl"
              class="input"
              placeholder="/uploads/images/project-logo.png"
            />
            <label class="btn-ghost btn-file">
              <input
                type="file"
                accept="image/*"
                :disabled="uploadingProjectLogo"
                @change="handleCreateProjectLogoUpload"
              />
              {{ uploadingProjectLogo ? "Uploading..." : "Upload" }}
            </label>
          </div>
        </div>
        <div class="checks-row">
          <label
            ><input
              type="radio"
              name="project-call-type"
              value="inbound"
              v-model="projectForm.callType"
            />
            Inbound</label
          >
          <label
            ><input
              type="radio"
              name="project-call-type"
              value="outbound"
              v-model="projectForm.callType"
            />
            Outbound</label
          >
        </div>
        <label class="msg-muted" for="project-ce-scoring-policy"
          >CE Scoring Policy</label
        >
        <select
          id="project-ce-scoring-policy"
          v-model="projectForm.ceScoringPolicy"
          class="input"
        >
          <option value="strict_zero_all_ce_if_any_fail">
            Strict (zero all CE if one fails)
          </option>
          <option value="weighted_ce_independent">
            Weighted (independent CE scores)
          </option>
        </select>
        <label class="msg-muted" for="project-batch-lock-days"
          >Batch Lock Days</label
        >
        <input
          id="project-batch-lock-days"
          v-model.number="projectForm.batchHistoryLockDays"
          class="input"
          type="number"
          min="1"
          max="365"
          step="1"
          inputmode="numeric"
          @keydown="
            (e) =>
              ['e', 'E', '+', '-', '.'].includes(e.key) && e.preventDefault()
          "
        />
        <div class="modal-actions">
          <button class="btn-ghost" @click="showProjectModal = false">
            Cancel
          </button>
          <button
            class="btn-primary"
            :disabled="creatingProject"
            @click="createProjectAction"
          >
            Create
          </button>
        </div>
      </div>
    </div>

    <div v-if="showWorkspaceModal" class="overlay overlay-full">
      <div class="workspace-modal">
        <header class="workspace-header">
          <div>
            <p class="hero-eyebrow">Tenant Workspace</p>
            <h3 class="workspace-title">
              {{ workspaceTenant?.name || "Tenant" }}
            </h3>
          </div>
          <div class="workspace-head-actions">
            <button class="btn-ghost" @click="closeWorkspaceModal">
              Back To Manage Home
            </button>
          </div>
        </header>

        <div class="workspace-body">
          <aside class="project-panel">
            <div class="project-panel-head">
              <p class="panel-title">Projects</p>
              <div class="project-panel-actions">
                <button
                  class="btn-primary"
                  @click="openProjectModal(workspaceTenantId)"
                >
                  + Add Project
                </button>
                <button class="btn-ghost" @click="closeWorkspaceModal">
                  Back
                </button>
              </div>
            </div>
            <div v-if="!workspaceProjects.length" class="msg-muted">
              No project yet.
            </div>
            <div
              v-for="project in workspaceProjects"
              :key="project.id"
              class="project-row"
              :class="{
                'project-row-active': workspaceProjectId === project.id,
              }"
              @click="selectWorkspaceProject(project.id)"
              role="button"
              tabindex="0"
            >
              <div class="project-main">
                <div
                  class="project-logo"
                  :style="
                    project.logoUrl
                      ? getLogoBgStyle(resolveProjectLogoUrl(project.logoUrl))
                      : undefined
                  "
                >
                  <img
                    v-if="project.logoUrl"
                    :src="resolveProjectLogoUrl(project.logoUrl)"
                    :alt="`${project.name} logo`"
                    crossorigin="anonymous"
                    @load="applyDominantLogoColor"
                  />
                  <ImageIcon v-else class="w-4 h-4" />
                </div>
                <div>
                <p class="project-name">{{ project.name }}</p>
                <p class="project-meta">
                  {{ project.supportsInbound ? "Inbound" : "" }}
                  {{
                    project.supportsInbound && project.supportsOutbound
                      ? " | "
                      : ""
                  }}
                  {{ project.supportsOutbound ? "Outbound" : "" }}
                  {{
                    (project.supportsInbound || project.supportsOutbound)
                      ? " | "
                      : ""
                  }}
                  {{
                    project.ceScoringPolicy === "weighted_ce_independent"
                      ? "CE Weighted"
                      : "CE Strict"
                  }}
                </p>
                </div>
              </div>
              <div class="tenant-card-actions" @click.stop>
                <button
                  class="btn-ghost"
                  @click="openEditProjectModal(project)"
                >
                  Edit
                </button>
                <button
                  class="btn-danger"
                  @click="deleteProjectAction(project)"
                >
                  Delete
                </button>
              </div>
            </div>
          </aside>

          <section class="matrix-panel">
            <div class="matrix-head">
              <div>
                <p class="panel-title">QA Evaluation Matrix</p>
                <p class="msg-muted" v-if="activeProject">
                  Project: {{ activeProject.name }}
                  <span
                    class="policy-badge"
                    :class="
                      activeProject.ceScoringPolicy === 'weighted_ce_independent'
                        ? 'policy-badge-weighted'
                        : 'policy-badge-strict'
                    "
                  >
                    {{
                      activeProject.ceScoringPolicy === "weighted_ce_independent"
                        ? "CE Weighted"
                        : "CE Strict"
                    }}
                  </span>
                </p>
              </div>
              <div class="toggle-row">
                <button
                  class="btn-ghost"
                  :class="{ 'btn-toggle-active': matrixCallType === 'inbound' }"
                  :disabled="!canUseInboundMatrix"
                  @click="matrixCallType = 'inbound'"
                >
                  Inbound
                </button>
                <button
                  class="btn-ghost"
                  :class="{
                    'btn-toggle-active': matrixCallType === 'outbound',
                  }"
                  :disabled="!canUseOutboundMatrix"
                  @click="matrixCallType = 'outbound'"
                >
                  Outbound
                </button>
              </div>
            </div>

            <p v-if="!activeProject" class="msg-muted">
              Select a project to manage matrix.
            </p>
            <p v-else-if="matrixError" class="msg-error">{{ matrixError }}</p>
            <p v-else-if="matrixLoading" class="msg-muted">
              Loading versions...
            </p>

            <div v-if="activeProject" class="matrix-layout">
              <div class="version-panel">
                <div class="version-panel-head">
                  <p class="panel-title">Versions</p>
                  <button
                    class="btn-primary btn-sm"
                    :disabled="matrixBusy"
                    @click="createMatrixVersionAction"
                  >
                    + Create
                  </button>
                </div>
                <div v-if="!matrixVersions.length" class="msg-muted">
                  No versions yet.
                </div>
                <div v-else class="version-list">
                  <div
                    v-for="version in matrixVersions"
                    :key="version.id"
                    class="matrix-version-row-wrapper"
                  >
                    <button
                      class="matrix-version-row"
                      :class="{
                        'matrix-version-row-active':
                          selectedMatrixVersionId === version.id,
                      }"
                      @click="selectMatrixVersionAction(version.id)"
                    >
                      <span>v{{ version.versionNumber }}</span>
                      <div
                        style="display: flex; align-items: center; gap: 0.4rem"
                      >
                        <span v-if="version.isActive" class="matrix-badge"
                          >Active</span
                        >
                        <div class="menu-container" @click.stop>
                          <button
                            class="btn-icon"
                            @click="
                              openMenuId =
                                openMenuId === version.id ? null : version.id
                            "
                          >
                            <MoreVertical class="w-4 h-4" />
                          </button>

                          <!-- Dropdown Menu -->
                          <div
                            v-if="openMenuId === version.id"
                            class="dropdown-menu"
                          >
                            <button
                              class="dropdown-item"
                              :disabled="matrixBusy || version.isActive"
                              @click="
                                openMenuId = null;
                                activateMatrixVersionAction(version.id);
                              "
                            >
                              Activate
                            </button>
                            <button
                              class="dropdown-item text-danger"
                              :disabled="matrixBusy || version.isActive"
                              @click="
                                openMenuId = null;
                                deleteMatrixVersionAction(version.id);
                              "
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              <div class="editor-panel">
                <div class="editor-head">
                  <div class="editor-head-left">
                    <p class="panel-title">Evaluation Parameters</p>
                    <span v-if="matrixDirty" class="dirty-badge"
                      >Unsaved changes</span
                    >
                  </div>
                  <div style="display: flex; gap: 0.5rem; align-items: center">
                    <input
                      type="file"
                      accept=".json"
                      class="hidden"
                      ref="jsonFileInput"
                      @change="handleJsonUpload"
                    />
                    <button class="btn-ghost" @click="triggerJsonUpload">
                      Upload JSON
                    </button>
                    <button class="btn-ghost" @click="addMatrixRow">
                      + Row
                    </button>
                    <button
                      v-if="matrixDirty"
                      class="btn-save-version"
                      :disabled="matrixBusy"
                      @click="saveDraftAction"
                    >
                      Save
                    </button>
                  </div>
                </div>
                <div class="rows-scroll">
                  <div
                    v-for="(row, idx) in matrixRowsDraft"
                    :key="`row-${idx}`"
                    class="matrix-row-grid"
                  >
                    <input
                      v-model="row.area"
                      class="input"
                      placeholder="Area"
                    />
                    <select
                      v-model="row.parameter"
                      class="input"
                      aria-label="CE or NCE dropdown"
                    >
                      <option value="CE">CE</option>
                      <option value="NCE">NCE</option>
                    </select>
                    <input
                      v-model.number="row.weight"
                      class="input"
                      type="number"
                      min="1"
                      step="1"
                      inputmode="numeric"
                      placeholder="Weight"
                      @keydown="
                        (e) =>
                          ['e', 'E', '+', '-', '.'].includes(e.key) &&
                          e.preventDefault()
                      "
                    />
                    <button
                      class="btn-edit-conditions"
                      :class="{ 'has-content': row.description?.trim() }"
                      @click="conditionEditIdx = idx"
                      :title="row.description || 'No conditions set'"
                    >
                      {{
                        row.description?.trim()
                          ? "Edit Conditions ✎"
                          : "Add Conditions ＋"
                      }}
                    </button>
                    <button class="btn-danger" @click="removeMatrixRow(idx)">
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- Condition Edit Modal -->
    <div
      v-if="conditionEditIdx !== null"
      class="overlay"
      @click.self="conditionEditIdx = null"
    >
      <div class="modal-card modal-card-wide">
        <h3 class="modal-title">
          Edit Conditions
          <span v-if="conditionRow" class="modal-title-sub">
            —
            {{ conditionRow.area || "Row " + ((conditionEditIdx ?? 0) + 1) }}
            ({{ conditionRow.parameter }})
          </span>
        </h3>
        <p class="modal-hint">
          Describe the specific evaluation conditions for this parameter.
        </p>
        <textarea
          v-if="conditionRow"
          v-model="conditionRow.description"
          class="input condition-textarea"
          placeholder="Enter evaluation conditions, rules, or criteria for this parameter..."
          rows="10"
          autofocus
        ></textarea>
        <div class="modal-actions">
          <button class="btn-primary" @click="conditionEditIdx = null">
            Done
          </button>
        </div>
      </div>
    </div>

    <div v-if="showEditTenantModal" class="overlay">
      <div class="modal-card">
        <h3 class="modal-title">Edit Tenant</h3>
        <input
          v-model="editTenantForm.name"
          class="input"
          placeholder="Tenant name"
        />
        <input
          v-model="editTenantForm.logoUrl"
          class="input"
          placeholder="/uploads/images/tenant-logo.png"
        />
        <label class="btn-ghost btn-file">
          <input
            type="file"
            accept="image/*"
            :disabled="uploadingEditTenantLogo"
            @change="handleEditTenantLogoUpload"
          />
          {{
            uploadingEditTenantLogo ? "Uploading Logo..." : "Upload Logo"
          }}
        </label>
        <div class="modal-actions">
          <button class="btn-ghost" @click="showEditTenantModal = false">
            Cancel
          </button>
          <button
            class="btn-primary"
            :disabled="savingTenantEdit"
            @click="saveTenantEdit"
          >
            Save
          </button>
        </div>
      </div>
    </div>

    <div v-if="showEditProjectModal" class="overlay">
      <div class="modal-card">
        <h3 class="modal-title">Edit Project</h3>
        <input
          v-model="editProjectForm.name"
          class="input"
          placeholder="Project name"
        />
        <div class="project-logo-field">
          <label class="msg-muted">Project logo</label>
          <div class="project-logo-input-row">
            <input
              v-model="editProjectForm.logoUrl"
              class="input"
              placeholder="/uploads/images/project-logo.png"
            />
            <label class="btn-ghost btn-file">
              <input
                type="file"
                accept="image/*"
                :disabled="uploadingEditProjectLogo"
                @change="handleEditProjectLogoUpload"
              />
              {{ uploadingEditProjectLogo ? "Uploading..." : "Upload" }}
            </label>
          </div>
        </div>
        <label class="msg-muted" for="edit-project-ce-scoring-policy"
          >CE Scoring Policy</label
        >
        <select
          id="edit-project-ce-scoring-policy"
          v-model="editProjectForm.ceScoringPolicy"
          class="input"
        >
          <option value="strict_zero_all_ce_if_any_fail">
            Strict (zero all CE if one fails)
          </option>
          <option value="weighted_ce_independent">
            Weighted (independent CE scores)
          </option>
        </select>
        <label class="msg-muted" for="edit-project-batch-lock-days"
          >Batch Lock Days</label
        >
        <input
          id="edit-project-batch-lock-days"
          v-model.number="editProjectForm.batchHistoryLockDays"
          class="input"
          type="number"
          min="1"
          max="365"
          step="1"
          inputmode="numeric"
          @keydown="
            (e) =>
              ['e', 'E', '+', '-', '.'].includes(e.key) && e.preventDefault()
          "
        />
        <div class="modal-actions">
          <button class="btn-ghost" @click="showEditProjectModal = false">
            Cancel
          </button>
          <button
            class="btn-primary"
            :disabled="savingProjectEdit"
            @click="saveProjectEdit"
          >
            Save
          </button>
        </div>
      </div>
    </div>

    <div v-if="showConfirmModal" class="overlay">
      <div class="modal-card">
        <h3 class="modal-title">{{ confirmTitle }}</h3>
        <p class="msg-muted">{{ confirmMessage }}</p>
        <div class="modal-actions">
          <button
            class="btn-ghost"
            :disabled="confirmBusy"
            @click="closeConfirmModal"
          >
            Cancel
          </button>
          <button
            class="btn-danger"
            :disabled="confirmBusy"
            @click="runConfirmAction"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.manage-shell {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.hero-card {
  border-radius: 1.2rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: linear-gradient(
    160deg,
    rgba(8, 47, 73, 0.62),
    rgba(2, 6, 23, 0.8)
  );
  padding: 1.2rem;
}

.hero-eyebrow {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: #bae6fd;
}

.hero-title {
  color: #f8fafc;
  font-size: 1.35rem;
  font-weight: 700;
  margin-top: 0.35rem;
}

.hero-sub {
  margin-top: 0.45rem;
  color: #cbd5e1;
  font-size: 0.82rem;
}

.hero-actions {
  margin-top: 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.cta-btn {
  border-radius: 0.8rem;
  padding: 0.8rem 1rem;
  font-size: 0.9rem;
  font-weight: 700;
  color: #082f49;
  background: linear-gradient(
    180deg,
    rgba(34, 211, 238, 0.95),
    rgba(8, 145, 178, 0.95)
  );
}

.cta-btn-secondary {
  color: #cffafe;
  border: 1px solid rgba(34, 211, 238, 0.5);
  background: rgba(8, 47, 73, 0.45);
}

.tenant-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 0.8rem;
}

.tenant-card {
  border-radius: 1rem;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(15, 23, 42, 0.6);
  padding: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  cursor: pointer;
}

.tenant-card:hover {
  border-color: rgba(34, 211, 238, 0.65);
}

.tenant-name {
  color: #f8fafc;
  font-size: 1.05rem;
  font-weight: 700;
}

.tenant-meta {
  margin-top: 0.2rem;
  color: #94a3b8;
  font-size: 0.75rem;
}

.tenant-card-actions {
  display: flex;
  gap: 0.4rem;
}

.overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(2, 6, 23, 0.82);
  backdrop-filter: blur(6px);
  display: grid;
  place-items: center;
  padding: 1rem;
}

.overlay-full {
  z-index: 110;
  padding: 0;
}

.modal-card {
  width: min(460px, 100%);
  border-radius: 1rem;
  border: 1px solid rgba(100, 116, 139, 0.55);
  background: rgba(15, 23, 42, 0.96);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.modal-title {
  color: #f8fafc;
  font-size: 1rem;
  font-weight: 700;
}

.modal-actions {
  margin-top: 0.3rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.workspace-modal {
  width: 100%;
  height: 100%;
  background: rgba(2, 6, 23, 0.98);
  display: flex;
  flex-direction: column;
}

.workspace-header {
  padding: 1rem;
  border-bottom: 1px solid rgba(71, 85, 105, 0.55);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.8rem;
}

.workspace-title {
  color: #f8fafc;
  font-size: 1.2rem;
  font-weight: 700;
}

.workspace-head-actions {
  display: flex;
  gap: 0.5rem;
}

.workspace-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 320px 1fr;
}

.project-panel {
  border-right: 1px solid rgba(71, 85, 105, 0.45);
  padding: 1rem;
  overflow-y: auto;
}

.project-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}

.project-panel-actions {
  display: flex;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.matrix-panel {
  padding: 1rem;
  overflow-y: auto;
}

.panel-title {
  color: #f8fafc;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.project-row {
  width: 100%;
  text-align: left;
  border-radius: 0.75rem;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(15, 23, 42, 0.6);
  margin-top: 0.6rem;
  padding: 0.65rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.project-main {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}

.project-logo {
  width: 2.25rem;
  aspect-ratio: 1 / 1;
  border-radius: 0.5rem;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(2, 6, 23, 0.65);
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.project-logo img {
  inline-size: 100%;
  block-size: 100%;
  object-fit: contain;
  object-position: center center;
}

.project-row-active {
  border-color: rgba(34, 211, 238, 0.65);
  box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.35);
}

.project-name {
  color: #f8fafc;
  font-size: 0.86rem;
  font-weight: 600;
}

.project-meta {
  color: #94a3b8;
  font-size: 0.7rem;
}

.matrix-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.7rem;
}

.toggle-row {
  display: flex;
  gap: 0.45rem;
}

.matrix-layout {
  margin-top: 0.9rem;
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 0.8rem;
}

.version-panel,
.editor-panel {
  border: 1px solid rgba(100, 116, 139, 0.45);
  border-radius: 0.9rem;
  background: rgba(15, 23, 42, 0.55);
  padding: 0.75rem;
}

.editor-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
}

.editor-head-left {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.dirty-badge {
  font-size: 0.66rem;
  color: #fb923c;
  background: rgba(251, 146, 60, 0.12);
  border: 1px solid rgba(251, 146, 60, 0.35);
  border-radius: 99px;
  padding: 0.15rem 0.55rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  animation: pulse-badge 1.5s ease-in-out infinite;
}

@keyframes pulse-badge {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.65;
  }
}

.btn-save-version {
  padding: 0.4rem 0.8rem;
  border-radius: 0.56rem;
  font-size: 0.76rem;
  font-weight: 700;
  color: #f0fdf4;
  border: 1px solid rgba(34, 197, 94, 0.5);
  background: linear-gradient(
    180deg,
    rgba(34, 197, 94, 0.82),
    rgba(21, 128, 61, 0.88)
  );
  transition:
    opacity 0.15s,
    filter 0.15s;
}

.btn-save-version:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-save-version:not(:disabled):hover {
  filter: brightness(1.1);
}

.btn-edit-conditions {
  padding: 0.35rem 0.7rem;
  border-radius: 0.52rem;
  font-size: 0.73rem;
  font-weight: 600;
  color: #94a3b8;
  border: 1px dashed rgba(100, 116, 139, 0.5);
  background: rgba(15, 23, 42, 0.4);
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s,
    background 0.15s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}

.btn-edit-conditions:hover {
  border-color: rgba(34, 211, 238, 0.55);
  color: #67e8f9;
  background: rgba(34, 211, 238, 0.07);
}

.btn-edit-conditions.has-content {
  border-style: solid;
  color: #cbd5e1;
  border-color: rgba(100, 116, 139, 0.4);
}

.condition-textarea {
  width: 100%;
  min-height: 220px;
  resize: vertical;
  margin-top: 0.5rem;
  font-size: 0.84rem;
  line-height: 1.55;
}

.modal-card-wide {
  max-width: 560px;
  width: 90vw;
}

.modal-title-sub {
  font-weight: 400;
  font-size: 0.85rem;
  color: #94a3b8;
  margin-left: 0.2rem;
}

.modal-hint {
  color: #64748b;
  font-size: 0.76rem;
  margin-top: 0.2rem;
}

.version-panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.6rem;
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.matrix-version-row-wrapper {
  width: 100%;
}

.menu-container {
  position: relative;
  display: flex;
  align-items: center;
}

.btn-icon {
  background: transparent;
  border: none;
  color: #94a3b8;
  padding: 0.2rem;
  border-radius: 0.4rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s,
    color 0.15s;
}

.btn-icon:hover {
  background: rgba(148, 163, 184, 0.15);
  color: #e2e8f0;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 0.2rem;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(100, 116, 139, 0.4);
  border-radius: 0.5rem;
  padding: 0.3rem;
  min-width: 120px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.dropdown-item {
  width: 100%;
  text-align: left;
  padding: 0.4rem 0.6rem;
  font-size: 0.74rem;
  font-weight: 500;
  color: #e2e8f0;
  background: transparent;
  border: none;
  border-radius: 0.3rem;
  cursor: pointer;
  transition: background 0.15s;
}

.dropdown-item:hover:not(:disabled) {
  background: rgba(148, 163, 184, 0.15);
}

.dropdown-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dropdown-item.text-danger {
  color: #fca5a5;
}

.dropdown-item.text-danger:hover:not(:disabled) {
  background: rgba(248, 113, 113, 0.15);
}

.matrix-version-row {
  width: 100%;
  border-radius: 0.6rem;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(2, 6, 23, 0.6);
  color: #e2e8f0;
  font-size: 0.76rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0.5rem;
}

.matrix-version-row-active {
  border-color: rgba(34, 211, 238, 0.7);
}

.matrix-badge {
  font-size: 0.64rem;
  color: #86efac;
  border: 1px solid rgba(74, 222, 128, 0.55);
  border-radius: 999px;
  padding: 0.1rem 0.35rem;
}

.version-actions {
  margin-top: 0.7rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.editor-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.rows-scroll {
  margin-top: 0.7rem;
  max-height: 58vh;
  overflow-y: auto;
  padding-right: 0.3rem;
}

.matrix-row-grid {
  display: grid;
  grid-template-columns: 2fr 0.65fr 0.5fr 145px auto;
  gap: 0.45rem;
  align-items: center;
  margin-bottom: 0.45rem;
}

.matrix-textarea {
  min-height: 2.2rem;
  resize: vertical;
}

.input {
  width: 100%;
  border-radius: 0.6rem;
  border: 1px solid rgba(100, 116, 139, 0.55);
  background: rgba(15, 23, 42, 0.6);
  color: #e2e8f0;
  padding: 0.5rem 0.65rem;
  font-size: 0.8rem;
}

.checks-row {
  display: flex;
  gap: 0.8rem;
  color: #cbd5e1;
  font-size: 0.82rem;
}

.project-logo-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.project-logo-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem;
  align-items: center;
}

.btn-file {
  position: relative;
  overflow: hidden;
}

.btn-file input[type="file"] {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.btn-primary {
  padding: 0.45rem 0.7rem;
  border-radius: 0.55rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: #082f49;
  background: linear-gradient(
    180deg,
    rgba(34, 211, 238, 0.95),
    rgba(8, 145, 178, 0.95)
  );
}

.btn-ghost {
  padding: 0.45rem 0.7rem;
  border-radius: 0.55rem;
  font-size: 0.75rem;
  color: #cbd5e1;
  border: 1px solid rgba(100, 116, 139, 0.55);
  background: rgba(2, 6, 23, 0.45);
}

.btn-toggle-active {
  color: #67e8f9;
  border-color: rgba(34, 211, 238, 0.6);
  background: rgba(8, 47, 73, 0.45);
}

.btn-danger {
  padding: 0.45rem 0.7rem;
  border-radius: 0.55rem;
  font-size: 0.75rem;
  color: #fecaca;
  border: 1px solid rgba(248, 113, 113, 0.55);
  background: rgba(127, 29, 29, 0.32);
}

.msg-muted {
  font-size: 0.75rem;
  color: #94a3b8;
}

.policy-badge {
  display: inline-block;
  margin-left: 0.45rem;
  padding: 0.08rem 0.45rem;
  border-radius: 999px;
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.policy-badge-strict {
  color: #fecaca;
  border: 1px solid rgba(248, 113, 113, 0.55);
  background: rgba(127, 29, 29, 0.3);
}

.policy-badge-weighted {
  color: #bbf7d0;
  border: 1px solid rgba(74, 222, 128, 0.5);
  background: rgba(20, 83, 45, 0.35);
}

.msg-error {
  font-size: 0.75rem;
  color: #fda4af;
}

@media (max-width: 1100px) {
  .workspace-body {
    grid-template-columns: 1fr;
  }

  .project-panel {
    border-right: 0;
    border-bottom: 1px solid rgba(71, 85, 105, 0.45);
    max-height: 35vh;
  }

  .matrix-layout {
    grid-template-columns: 1fr;
  }

  .matrix-row-grid {
    grid-template-columns: 1fr;
  }
}
</style>
