const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
const WS_BASE = import.meta.env.VITE_WS_URL || "ws://localhost:3001/ws";

const getToken = () => localStorage.getItem("qa_token") || "";

const withAuth = (headers: Record<string, string> = {}) => {
  const token = getToken();
  if (!token) {
    throw new Error("Missing auth token.");
  }
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  };
};

const parse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const body = await response.text();
    let message = `Request failed with ${response.status}`;

    if (body) {
      try {
        const parsed = JSON.parse(body) as { message?: unknown };
        if (typeof parsed?.message === "string" && parsed.message.trim()) {
          message = parsed.message;
        } else {
          message = body;
        }
      } catch {
        message = body;
      }
    }

    throw new Error(message);
  }
  return response.json() as Promise<T>;
};

export const register = async (email: string, password: string) => {
  const response = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return parse<{ token: string; user: { id: string; email: string } }>(
    response,
  );
};

export const login = async (email: string, password: string) => {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return parse<{ token: string; user: { id: string; email: string } }>(
    response,
  );
};

export const getAuthBootstrapStatus = async () => {
  const response = await fetch(`${API_BASE}/auth/bootstrap-status`);
  return parse<{ canRegister: boolean }>(response);
};

export type Tenant = {
  id: string;
  name: string;
  logoUrl?: string | null;
};

export type Project = {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  supportsInbound: boolean;
  supportsOutbound: boolean;
  ceScoringPolicy:
    | "strict_zero_all_ce_if_any_fail"
    | "weighted_ce_independent";
};

export type BatchHistoryItem = {
  id: string;
  tenantId: string;
  projectId: string;
  callType: "inbound" | "outbound";
  status: string;
  createdAt: string;
  updatedAt: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
};

export type MatrixCallType = "inbound" | "outbound";

export type MatrixRow = {
  id?: string;
  rowIndex?: number;
  area: string;
  parameter: string;
  description: string;
  weight: number;
};

export type MatrixVersion = {
  id: string;
  projectId: string;
  callType: MatrixCallType;
  versionNumber: number;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
};

export type MatrixVersionDetail = MatrixVersion & {
  rows: MatrixRow[];
};

export const AVAILABLE_PERMISSION_KEYS = [
  "tenants:view",
  "tenants:manage",
  "projects:view",
  "projects:manage",
  "matrices:view",
  "matrices:manage",
  "jobs:view",
  "jobs:manage",
  "settings:view",
  "settings:manage",
  "users:manage",
  "roles:manage",
  "system:manage",
] as const;

export type PermissionKey = (typeof AVAILABLE_PERMISSION_KEYS)[number];

export type RoleScope = {
  includeAllTenants: boolean;
  includeAllProjects: boolean;
  tenantIds: string[];
  projectIds: string[];
};

export type AccessRole = {
  id: string;
  name: string;
  description?: string | null;
  permissions: PermissionKey[];
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  assignmentCount: number;
};

export type UserRoleAssignment = {
  id: string;
  roleId: string;
  roleName: string;
  permissions: PermissionKey[];
  scope: RoleScope;
};

export type SettingsUser = {
  id: string;
  email: string;
  isRestricted: boolean;
  createdAt: string;
  updatedAt: string;
  assignments: UserRoleAssignment[];
};

export type SettingsUserProfile = {
  id: string;
  email: string;
  isRestricted: boolean;
  createdAt: string;
  updatedAt: string;
};

export const listTenants = async () => {
  const response = await fetch(`${API_BASE}/tenants`, { headers: withAuth() });
  return parse<Tenant[]>(response);
};

export const createTenant = async (payload: {
  name: string;
  logoUrl?: string | null;
}) => {
  const response = await fetch(`${API_BASE}/tenants`, {
    method: "POST",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parse<Tenant>(response);
};

export const updateTenant = async (
  tenantId: string,
  payload: { name?: string; logoUrl?: string | null },
) => {
  const response = await fetch(`${API_BASE}/tenants/${tenantId}`, {
    method: "PATCH",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parse<Tenant>(response);
};

export const deleteTenant = async (tenantId: string) => {
  const response = await fetch(`${API_BASE}/tenants/${tenantId}`, {
    method: "DELETE",
    headers: withAuth(),
  });
  return parse<{ ok: boolean }>(response);
};

export const listProjects = async (tenantId: string) => {
  const response = await fetch(`${API_BASE}/tenants/${tenantId}/projects`, {
    headers: withAuth(),
  });
  return parse<Project[]>(response);
};

export const createProject = async (
  tenantId: string,
  payload: {
    name: string;
    logoUrl?: string | null;
    supportsInbound: boolean;
    supportsOutbound: boolean;
    ceScoringPolicy?:
      | "strict_zero_all_ce_if_any_fail"
      | "weighted_ce_independent";
  },
) => {
  const response = await fetch(`${API_BASE}/tenants/${tenantId}/projects`, {
    method: "POST",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parse<Project>(response);
};

export const updateProject = async (
  tenantId: string,
  projectId: string,
  payload: {
    name?: string;
    logoUrl?: string | null;
    supportsInbound?: boolean;
    supportsOutbound?: boolean;
    ceScoringPolicy?:
      | "strict_zero_all_ce_if_any_fail"
      | "weighted_ce_independent";
  },
) => {
  const response = await fetch(
    `${API_BASE}/tenants/${tenantId}/projects/${projectId}`,
    {
      method: "PATCH",
      headers: withAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    },
  );
  return parse<Project>(response);
};

export const uploadImage = async (file: File) => {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${API_BASE}/uploads/images`, {
    method: "POST",
    headers: withAuth(),
    body: form,
  });

  return parse<{ path: string }>(response);
};

export const uploadProjectLogo = async (file: File) => uploadImage(file);

export const deleteProject = async (tenantId: string, projectId: string) => {
  const response = await fetch(
    `${API_BASE}/tenants/${tenantId}/projects/${projectId}`,
    {
      method: "DELETE",
      headers: withAuth(),
    },
  );
  return parse<{ ok: boolean }>(response);
};

export const listMatrixVersions = async (
  projectId: string,
  callType: MatrixCallType,
) => {
  const response = await fetch(
    `${API_BASE}/projects/${projectId}/matrices/${callType}/versions`,
    {
      headers: withAuth(),
    },
  );
  return parse<MatrixVersion[]>(response);
};

export const getActiveMatrixVersion = async (
  projectId: string,
  callType: MatrixCallType,
) => {
  const response = await fetch(
    `${API_BASE}/projects/${projectId}/matrices/${callType}/active`,
    {
      headers: withAuth(),
    },
  );
  return parse<MatrixVersionDetail>(response);
};

export const getMatrixVersion = async (
  projectId: string,
  callType: MatrixCallType,
  versionId: string,
) => {
  const response = await fetch(
    `${API_BASE}/projects/${projectId}/matrices/${callType}/versions/${versionId}`,
    {
      headers: withAuth(),
    },
  );
  return parse<MatrixVersionDetail>(response);
};

export const createMatrixVersion = async (
  projectId: string,
  callType: MatrixCallType,
  rows: MatrixRow[],
) => {
  const response = await fetch(
    `${API_BASE}/projects/${projectId}/matrices/${callType}/versions`,
    {
      method: "POST",
      headers: withAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ rows }),
    },
  );
  return parse<MatrixVersion>(response);
};

export const updateMatrixVersion = async (
  projectId: string,
  callType: MatrixCallType,
  versionId: string,
  rows: MatrixRow[],
) => {
  const response = await fetch(
    `${API_BASE}/projects/${projectId}/matrices/${callType}/versions/${versionId}`,
    {
      method: "PUT",
      headers: withAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ rows }),
    },
  );
  return parse<{ ok: boolean }>(response);
};

export const activateMatrixVersion = async (
  projectId: string,
  callType: MatrixCallType,
  versionId: string,
) => {
  const response = await fetch(
    `${API_BASE}/projects/${projectId}/matrices/${callType}/versions/${versionId}/activate`,
    {
      method: "POST",
      headers: withAuth(),
    },
  );
  return parse<{ ok: boolean }>(response);
};

export const deleteMatrixVersion = async (
  projectId: string,
  callType: MatrixCallType,
  versionId: string,
) => {
  const response = await fetch(
    `${API_BASE}/projects/${projectId}/matrices/${callType}/versions/${versionId}`,
    {
      method: "DELETE",
      headers: withAuth(),
    },
  );
  return parse<{ ok: boolean }>(response);
};

export const getGlobalSettings = async () => {
  const response = await fetch(`${API_BASE}/settings/system`, {
    headers: withAuth(),
  });
  return parse<{
    hasElevenlabsApiKey: boolean;
    hasXaiApiKey: boolean;
    xaiModel: string;
  }>(response);
};

export const updateGlobalSettings = async (payload: {
  elevenlabsApiKey?: string;
  xaiApiKey?: string;
  xaiModel?: string;
}) => {
  const response = await fetch(`${API_BASE}/settings/system`, {
    method: "PUT",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parse<{
    ok: boolean;
    hasElevenlabsApiKey: boolean;
    hasXaiApiKey: boolean;
    xaiModel: string;
  }>(response);
};

export const listAccessRoles = async () => {
  const response = await fetch(`${API_BASE}/settings/roles`, {
    headers: withAuth(),
  });
  return parse<AccessRole[]>(response);
};

export const createAccessRole = async (payload: {
  name: string;
  description?: string | null;
  permissions: PermissionKey[];
}) => {
  const response = await fetch(`${API_BASE}/settings/roles`, {
    method: "POST",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parse<AccessRole>(response);
};

export const updateAccessRole = async (
  roleId: string,
  payload: {
    name?: string;
    description?: string | null;
    permissions?: PermissionKey[];
  },
) => {
  const response = await fetch(`${API_BASE}/settings/roles/${roleId}`, {
    method: "PATCH",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parse<AccessRole>(response);
};

export const deleteAccessRole = async (roleId: string) => {
  const response = await fetch(`${API_BASE}/settings/roles/${roleId}`, {
    method: "DELETE",
    headers: withAuth(),
  });
  return parse<{ ok: boolean }>(response);
};

export const listSettingsUsers = async () => {
  const response = await fetch(`${API_BASE}/settings/users`, {
    headers: withAuth(),
  });
  return parse<SettingsUser[]>(response);
};

export const updateSettingsUserAccess = async (
  userId: string,
  payload: {
    isRestricted: boolean;
    assignments: Array<{
      roleId: string;
      scope: Partial<RoleScope>;
    }>;
  },
) => {
  const response = await fetch(`${API_BASE}/settings/users/${userId}/access`, {
    method: "PUT",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parse<{ ok: boolean }>(response);
};

export const createSettingsUser = async (payload: {
  email: string;
  password: string;
  isRestricted?: boolean;
}) => {
  const response = await fetch(`${API_BASE}/settings/users`, {
    method: "POST",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parse<SettingsUser>(response);
};

export const updateSettingsUser = async (
  userId: string,
  payload: {
    email?: string;
    isRestricted?: boolean;
  },
) => {
  const response = await fetch(`${API_BASE}/settings/users/${userId}`, {
    method: "PATCH",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parse<SettingsUserProfile>(response);
};

export const changeSettingsUserPassword = async (userId: string, password: string) => {
  const response = await fetch(`${API_BASE}/settings/users/${userId}/password`, {
    method: "PUT",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify({ password }),
  });
  return parse<{ ok: boolean }>(response);
};

export const deleteSettingsUser = async (userId: string) => {
  const response = await fetch(`${API_BASE}/settings/users/${userId}`, {
    method: "DELETE",
    headers: withAuth(),
  });
  return parse<{ ok: boolean }>(response);
};

export const createBatch = async (payload: {
  tenantId: string;
  projectId: string;
  callType: "inbound" | "outbound";
  files: File[];
}) => {
  const form = new FormData();
  form.append("tenantId", payload.tenantId);
  form.append("projectId", payload.projectId);
  form.append("callType", payload.callType);
  for (const file of payload.files) {
    form.append("files", file);
  }

  const response = await fetch(`${API_BASE}/batches`, {
    method: "POST",
    headers: withAuth(),
    body: form,
  });

  return parse<{ batchId: string; jobIds: string[] }>(response);
};

export const listProjectBatches = async (projectId: string) => {
  const response = await fetch(`${API_BASE}/projects/${projectId}/batches`, {
    headers: withAuth(),
  });
  return parse<BatchHistoryItem[]>(response);
};

export const createProjectBatch = async (payload: {
  tenantId: string;
  projectId: string;
  callType: "inbound" | "outbound";
  name?: string;
}) => {
  const response = await fetch(
    `${API_BASE}/projects/${payload.projectId}/batches`,
    {
      method: "POST",
      headers: withAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        tenantId: payload.tenantId,
        callType: payload.callType,
        name: payload.name,
      }),
    },
  );
  return parse<{
    id: string;
    tenantId: string;
    projectId: string;
    callType: "inbound" | "outbound";
    status: string;
    createdAt: string;
    updatedAt: string;
  }>(response);
};

export const uploadBatchFiles = async (payload: {
  batchId: string;
  files: File[];
  analyzeNow: boolean;
}) => {
  const form = new FormData();
  for (const file of payload.files) {
    form.append("files", file);
  }
  form.append("analyzeNow", String(payload.analyzeNow));

  const response = await fetch(`${API_BASE}/batches/${payload.batchId}/files`, {
    method: "POST",
    headers: withAuth(),
    body: form,
  });
  return parse<{ batchId: string; jobIds: string[]; analyzeNow: boolean }>(
    response,
  );
};

export const analyzeBatchNow = async (batchId: string) => {
  const response = await fetch(`${API_BASE}/batches/${batchId}/analyze`, {
    method: "POST",
    headers: withAuth(),
  });
  return parse<{ ok: boolean; enqueued: number }>(response);
};

export const deleteBatch = async (batchId: string) => {
  const response = await fetch(`${API_BASE}/batches/${batchId}`, {
    method: "DELETE",
    headers: withAuth(),
  });
  return parse<{ ok: boolean }>(response);
};

export const getBatch = async (batchId: string) => {
  const response = await fetch(`${API_BASE}/batches/${batchId}`, {
    headers: withAuth(),
  });
  return parse<any>(response);
};

export const getJob = async (jobId: string) => {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
    headers: withAuth(),
  });
  return parse<any>(response);
};

export const getJobAudioUrl = (jobId: string) => {
  const token = getToken();
  if (!token) {
    throw new Error("Missing auth token.");
  }
  return `${API_BASE}/jobs/${jobId}/audio?token=${encodeURIComponent(token)}`;
};

export const deleteJob = async (jobId: string) => {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
    method: "DELETE",
    headers: withAuth(),
  });
  return parse<{ ok: boolean }>(response);
};

export const retryJob = async (jobId: string) => {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/retry`, {
    method: "POST",
    headers: withAuth(),
  });
  return parse<{ ok: boolean }>(response);
};

export const connectWs = (
  onEvent: (event: Record<string, unknown>) => void,
) => {
  const token = getToken();
  if (!token) {
    throw new Error("Missing auth token for websocket connection");
  }

  const url = `${WS_BASE}?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(String(event.data));
      onEvent(payload);
    } catch {
      // Ignore malformed events.
    }
  };

  return ws;
};

export const subscribeBatch = (ws: WebSocket, batchId: string) => {
  ws.send(JSON.stringify({ event: "subscribe.batch", batchId }));
};

export const subscribeJob = (ws: WebSocket, jobId: string) => {
  ws.send(JSON.stringify({ event: "subscribe.job", jobId }));
};
