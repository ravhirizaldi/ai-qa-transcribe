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
    throw new Error(body || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export const register = async (email: string, password: string) => {
  const response = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return parse<{ token: string; user: { id: string; email: string } }>(response);
};

export const login = async (email: string, password: string) => {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return parse<{ token: string; user: { id: string; email: string } }>(response);
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
  supportsInbound: boolean;
  supportsOutbound: boolean;
};

export const listTenants = async () => {
  const response = await fetch(`${API_BASE}/tenants`, { headers: withAuth() });
  return parse<Tenant[]>(response);
};

export const createTenant = async (payload: { name: string; logoUrl?: string | null }) => {
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
  payload: { name: string; supportsInbound: boolean; supportsOutbound: boolean },
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
  payload: { name?: string; supportsInbound?: boolean; supportsOutbound?: boolean },
) => {
  const response = await fetch(`${API_BASE}/tenants/${tenantId}/projects/${projectId}`, {
    method: "PATCH",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parse<Project>(response);
};

export const deleteProject = async (tenantId: string, projectId: string) => {
  const response = await fetch(`${API_BASE}/tenants/${tenantId}/projects/${projectId}`, {
    method: "DELETE",
    headers: withAuth(),
  });
  return parse<{ ok: boolean }>(response);
};

export const getGlobalSettings = async () => {
  const response = await fetch(`${API_BASE}/settings/global`, {
    headers: withAuth(),
  });
  return parse<{ hasElevenlabsApiKey: boolean; hasXaiApiKey: boolean; xaiModel: string }>(
    response,
  );
};

export const updateGlobalSettings = async (payload: {
  elevenlabsApiKey?: string;
  xaiApiKey?: string;
  xaiModel?: string;
}) => {
  const response = await fetch(`${API_BASE}/settings/global`, {
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

export const connectWs = (onEvent: (event: Record<string, unknown>) => void) => {
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
