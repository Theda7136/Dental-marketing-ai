import type { ClinicRole } from "@prisma/client";

export type ClinicPermission =
  | "content:read"
  | "content:write"
  | "content:review"
  | "content:publish"
  | "connections:manage"
  | "members:manage"
  | "brand:manage";

const permissions: Record<ClinicRole, ReadonlySet<ClinicPermission>> = {
  OWNER: new Set([
    "content:read", "content:write", "content:review", "content:publish",
    "connections:manage", "members:manage", "brand:manage",
  ]),
  ADMIN: new Set([
    "content:read", "content:write", "content:review", "content:publish",
    "connections:manage", "members:manage", "brand:manage",
  ]),
  EDITOR: new Set(["content:read", "content:write"]),
  REVIEWER: new Set(["content:read", "content:review"]),
};

export function canPerform(role: ClinicRole, permission: ClinicPermission): boolean {
  return permissions[role]?.has(permission) ?? false;
}
