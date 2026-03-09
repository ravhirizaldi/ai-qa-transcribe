import { ref } from "vue";
import { clearAuthMeCache } from "./backendApi";

const tokenRef = ref<string>(localStorage.getItem("qa_token") || "");
const tenantIdRef = ref<string>(localStorage.getItem("qa_tenant_id") || "");
const projectIdRef = ref<string>(localStorage.getItem("qa_project_id") || "");

export const useSession = () => {
  const setToken = (token: string) => {
    clearAuthMeCache();
    tokenRef.value = token;
    if (token) localStorage.setItem("qa_token", token);
    else localStorage.removeItem("qa_token");
  };

  const setTenantId = (tenantId: string) => {
    tenantIdRef.value = tenantId;
    if (tenantId) localStorage.setItem("qa_tenant_id", tenantId);
    else localStorage.removeItem("qa_tenant_id");
  };

  const setProjectId = (projectId: string) => {
    projectIdRef.value = projectId;
    if (projectId) localStorage.setItem("qa_project_id", projectId);
    else localStorage.removeItem("qa_project_id");
  };

  const clear = () => {
    setToken("");
    setTenantId("");
    setProjectId("");
  };

  return {
    token: tokenRef,
    tenantId: tenantIdRef,
    projectId: projectIdRef,
    setToken,
    setTenantId,
    setProjectId,
    clear,
  };
};
