import { ref } from "vue";
import { clearAuthMeCache } from "./backendApi";

const TOKEN_KEY = "qa_token";
const TENANT_KEY = "qa_tenant_id";
const PROJECT_KEY = "qa_project_id";
const REMEMBER_KEY = "qa_remember_me";

const readStorage = (key: string) =>
  localStorage.getItem(key) || sessionStorage.getItem(key) || "";

const removeFromAllStorage = (key: string) => {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
};

const tokenRef = ref<string>(readStorage(TOKEN_KEY));
const tenantIdRef = ref<string>(readStorage(TENANT_KEY));
const projectIdRef = ref<string>(readStorage(PROJECT_KEY));

export const useSession = () => {
  const isRemembered = () => localStorage.getItem(REMEMBER_KEY) === "true";

  const setToken = (token: string, opts?: { remember?: boolean }) => {
    clearAuthMeCache();
    tokenRef.value = token;
    if (token) {
      const remember = opts?.remember ?? isRemembered();
      removeFromAllStorage(TOKEN_KEY);
      if (remember) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(REMEMBER_KEY, "true");
      } else {
        sessionStorage.setItem(TOKEN_KEY, token);
        localStorage.removeItem(REMEMBER_KEY);
      }
    } else {
      removeFromAllStorage(TOKEN_KEY);
      localStorage.removeItem(REMEMBER_KEY);
    }
  };

  const setTenantId = (tenantId: string) => {
    tenantIdRef.value = tenantId;
    if (tenantId) {
      removeFromAllStorage(TENANT_KEY);
      if (isRemembered()) {
        localStorage.setItem(TENANT_KEY, tenantId);
      } else {
        sessionStorage.setItem(TENANT_KEY, tenantId);
      }
    } else {
      removeFromAllStorage(TENANT_KEY);
    }
  };

  const setProjectId = (projectId: string) => {
    projectIdRef.value = projectId;
    if (projectId) {
      removeFromAllStorage(PROJECT_KEY);
      if (isRemembered()) {
        localStorage.setItem(PROJECT_KEY, projectId);
      } else {
        sessionStorage.setItem(PROJECT_KEY, projectId);
      }
    } else {
      removeFromAllStorage(PROJECT_KEY);
    }
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
