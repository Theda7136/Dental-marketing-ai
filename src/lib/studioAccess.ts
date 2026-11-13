import { cookies } from "next/headers";
import { canPerform, type ClinicPermission } from "@/lib/clinicPermissions";
import { readStudioSession, STUDIO_SESSION_COOKIE } from "@/lib/studioSession";

export async function getStudioAccess(permission: ClinicPermission) {
  const token = (await cookies()).get(STUDIO_SESSION_COOKIE)?.value;
  const session = await readStudioSession(token);

  // The pilot gate stays in place until OAuth, media storage and publishing
  // have been audited for cross-clinic access.
  if (!session || session.clinic.id !== "pilot" || !canPerform(session.role, permission)) {
    return null;
  }

  return session;
}
