import { createRouter, createWebHistory } from "vue-router";
import LoginPage from "../pages/LoginPage.vue";
import ManagePage from "../pages/ManagePage.vue";
import SettingsPage from "../pages/SettingsPage.vue";
import SingleQAPage from "../pages/SingleQAPage.vue";
import BatchQAPage from "../pages/BatchQAPage.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/batch" },
    { path: "/login", component: LoginPage, meta: { public: true } },
    { path: "/manage", component: ManagePage },
    { path: "/settings", component: SettingsPage },
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
