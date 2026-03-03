import { createRouter, createWebHistory } from "vue-router";
import LoginPage from "../pages/LoginPage.vue";
import ManagePage from "../pages/ManagePage.vue";
import SingleQAPage from "../pages/SingleQAPage.vue";
import BatchQAPage from "../pages/BatchQAPage.vue";
import SettingsLayoutPage from "../pages/settings/SettingsLayoutPage.vue";
import UsersSettingsPage from "../pages/settings/UsersSettingsPage.vue";
import RolesSettingsPage from "../pages/settings/RolesSettingsPage.vue";
import SystemSettingsPage from "../pages/settings/SystemSettingsPage.vue";

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
    { path: "/single", component: SingleQAPage },
    { path: "/batch", component: BatchQAPage },
  ],
});

router.beforeEach((to) => {
  const isPublic = Boolean(to.meta.public);
  const token = localStorage.getItem("qa_token");

  if (!isPublic && !token) {
    return "/login";
  }

  if (isPublic && token) {
    return "/batch";
  }

  return true;
});

export default router;
