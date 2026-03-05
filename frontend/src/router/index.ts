import { createRouter, createWebHistory } from "vue-router";
import LoginPage from "../pages/LoginPage.vue";
import ManagePage from "../pages/ManagePage.vue";
import BatchQAPage from "../pages/BatchQAPage.vue";
import SettingsLayoutPage from "../pages/settings/SettingsLayoutPage.vue";
import UsersSettingsPage from "../pages/settings/UsersSettingsPage.vue";
import RolesSettingsPage from "../pages/settings/RolesSettingsPage.vue";
import SystemSettingsPage from "../pages/settings/SystemSettingsPage.vue";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

const canAccessManageFromPermissions = (permissions: Set<string>) => {
  return (
    permissions.has("tenants:view") ||
    permissions.has("tenants:manage") ||
    permissions.has("projects:view") ||
    permissions.has("projects:manage") ||
    permissions.has("matrices:view") ||
    permissions.has("matrices:manage")
  );
};

const canAccessSettingsFromPermissions = (permissions: Set<string>) => {
  return (
    permissions.has("settings:view") ||
    permissions.has("settings:manage") ||
    permissions.has("users:manage") ||
    permissions.has("roles:manage") ||
    permissions.has("system:manage")
  );
};

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/batch" },
    { path: "/login", component: LoginPage, meta: { public: true } },
    { path: "/manage", component: ManagePage },
    {
      path: "/settings",
      component: SettingsLayoutPage,
      children: [
        { path: "", redirect: "/settings/users" },
        { path: "users", component: UsersSettingsPage },
        { path: "roles", component: RolesSettingsPage },
        { path: "system", component: SystemSettingsPage },
      ],
    },
    { path: "/batch", component: BatchQAPage },
  ],
});

router.beforeEach(async (to) => {
  const isPublic = Boolean(to.meta.public);
  const token = localStorage.getItem("qa_token");

  if (!isPublic && !token) {
    return "/login";
  }

  if (isPublic && token) {
    return "/batch";
  }

  if (token && (to.path.startsWith("/settings") || to.path.startsWith("/manage"))) {
    try {
      const response = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return "/batch";
      const me = (await response.json()) as {
        isRestricted?: unknown;
        permissions?: unknown;
      };
      const isRestricted = me.isRestricted === true;
      const permissions = new Set(
        Array.isArray(me.permissions)
          ? me.permissions.filter((value): value is string => typeof value === "string")
          : [],
      );

      if (!isRestricted) return true;

      if (to.path.startsWith("/settings") && !canAccessSettingsFromPermissions(permissions)) {
        return "/batch";
      }
      if (to.path.startsWith("/manage") && !canAccessManageFromPermissions(permissions)) {
        return "/batch";
      }
    } catch {
      return "/batch";
    }
  }

  return true;
});

export default router;
