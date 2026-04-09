export type SettingsTab = {
  to: `/settings/${string}`;
  label: string;
  canAccess: (permissions: Set<string>) => boolean;
};

export const SETTINGS_TABS: SettingsTab[] = [
  {
    to: "/settings/users",
    label: "Users",
    canAccess: (permissions) => permissions.has("users:manage"),
  },
  {
    to: "/settings/roles",
    label: "Roles",
    canAccess: (permissions) => permissions.has("roles:manage"),
  },
  {
    to: "/settings/system",
    label: "System",
    canAccess: (permissions) => permissions.has("system:manage"),
  },
];

export const toPermissionSet = (permissions: unknown): Set<string> => {
  if (!Array.isArray(permissions)) return new Set();
  return new Set(
    permissions.filter((value): value is string => typeof value === "string"),
  );
};

export const getAccessibleSettingsTabs = (permissions: Set<string>) =>
  SETTINGS_TABS.filter((tab) => tab.canAccess(permissions));

export const canAccessAnySettingsTab = (permissions: Set<string>) =>
  getAccessibleSettingsTabs(permissions).length > 0;

export const getDefaultSettingsPath = (permissions: Set<string>) =>
  getAccessibleSettingsTabs(permissions)[0]?.to ?? "/batch";

export const canAccessSettingsPath = (
  path: string,
  permissions: Set<string>,
) =>
  getAccessibleSettingsTabs(permissions).some(
    (tab) => path === tab.to || path.startsWith(`${tab.to}/`),
  );
