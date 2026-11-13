import { cookies } from "next/headers";
import { canPerform, type ClinicPermission } from "@/lib/clinicPermissions";
import { readStudioSession, STUDIO_SESSION_COOKIE } from "@/lib/studioSession";

export async function getStudioAccess(permission: ClinicPermission) {
  const token = (await cookies()).get(STUDIO_SESSION_COOKIE)?.value;
  const session = await readStudioSession(token);

  if (!session || session.clinic.id !== "pilot" || !canPerform(session.role, permission)) {
    return null;
  }

  return session;
}
