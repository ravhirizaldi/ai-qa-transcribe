import { createRouter, createWebHistory } from "vue-router";
import { getAuthMeCached } from "../services/backendApi";

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
    {
      path: "/login",
      component: () => import("../pages/LoginPage.vue"),
      meta: { public: true },
    },
    { path: "/manage", component: () => import("../pages/ManagePage.vue") },
    {
      path: "/settings",
      component: () => import("../pages/settings/SettingsLayoutPage.vue"),
      children: [
        { path: "", redirect: "/settings/users" },
        {
          path: "users",
          component: () => import("../pages/settings/UsersSettingsPage.vue"),
        },
        {
          path: "roles",
          component: () => import("../pages/settings/RolesSettingsPage.vue"),
        },
        {
          path: "system",
          component: () => import("../pages/settings/SystemSettingsPage.vue"),
        },
      ],
    },
    { path: "/batch", component: () => import("../pages/BatchQAPage.vue") },
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
      const me = await getAuthMeCached();
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
