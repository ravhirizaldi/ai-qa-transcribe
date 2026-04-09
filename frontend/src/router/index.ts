import { createRouter, createWebHistory } from "vue-router";
import { toast } from "vue-sonner";
import { getAuthMeCached } from "../services/backendApi";
import {
  canAccessAnySettingsTab,
  canAccessSettingsPath,
  getDefaultSettingsPath,
  toPermissionSet,
} from "../utils/settingsAccess";

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
  const token =
    localStorage.getItem("qa_token") || sessionStorage.getItem("qa_token");

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
      const permissions = toPermissionSet(me.permissions);

      if (!isRestricted) return true;

      if (to.path.startsWith("/settings")) {
        if (!canAccessAnySettingsTab(permissions)) {
          toast.error("You do not have access to settings.");
          return "/batch";
        }
        if (!canAccessSettingsPath(to.path, permissions)) {
          toast.error("You do not have access to this settings page.");
          return getDefaultSettingsPath(permissions);
        }
      }
      if (to.path.startsWith("/manage") && !canAccessManageFromPermissions(permissions)) {
        toast.error("You do not have access to tenant and project management.");
        return "/batch";
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to verify your access. Redirected to QA Calculation.",
      );
      return "/batch";
    }
  }

  return true;
});

export default router;
