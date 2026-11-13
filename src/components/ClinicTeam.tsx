"use client";

import { useEffect, useState, type FormEvent } from "react";

type Member = { id: string; userId: string; email: string; displayName: string; role: string };
type Invitation = { id: string; email: string; role: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null };

export function ClinicTeam() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [myId, setMyId] = useState("");
  const [myRole, setMyRole] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EDITOR");
  const [inviteUrl, setInviteUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);

  async function load() {
    const [membersResponse, invitesResponse, meResponse] = await Promise.all([
      fetch("/api/studio/members", { cache: "no-store" }),
      fetch("/api/studio/invitations", { cache: "no-store" }),
      fetch("/api/studio/me", { cache: "no-store" }),
    ]);
    if (!membersResponse.ok || !invitesResponse.ok || !meResponse.ok) throw new Error("No se pudo cargar el equipo.");
    const memberPayload = await membersResponse.json();
    const invitePayload = await invitesResponse.json();
    const mePayload = await meResponse.json();
    setMembers(memberPayload.members);
    setMyId(memberPayload.currentUserId);
    setMyRole(mePayload.role);
    setInvitations(invitePayload.invitations);
  }

  useEffect(() => { load().catch((error) => setNotice(error.message)); }, []);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setNotice("");
    setInviteUrl("");
    try {
      const response = await fetch("/api/studio/invitations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo crear la invitación.");
      setInviteUrl(payload.invitationUrl);
      setEmail("");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo invitar.");
    } finally {
      setWorking(false);
    }
  }

  async function changeMember(id: string, nextRole: string | null) {
    const removing = nextRole === null;
    if (!window.confirm(removing ? "¿Retirar este usuario del equipo?" : "¿Cambiar el rol y cerrar sus sesiones abiertas?")) return;
    try {
      const response = await fetch(`/api/studio/members/${id}`, {
        method: removing ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        ...(!removing ? { body: JSON.stringify({ role: nextRole }) } : {}),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "No se pudo guardar.");
      }
      setNotice("Membresía actualizada. Las sesiones anteriores del usuario se han revocado.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo guardar.");
    }
  }

  async function revokeInvite(id: string) {
    if (!window.confirm("¿Revocar este enlace de invitación?")) return;
    const response = await fetch(`/api/studio/invitations/${id}`, { method: "DELETE" });
    if (!response.ok) { setNotice("No se pudo revocar la invitación."); return; }
    setNotice("Invitación revocada.");
    await load().catch(() => setNotice("No se pudo actualizar la lista."));
  }

  const canManage = (member: Member) => member.userId !== myId &&
    member.role !== "OWNER" && (myRole === "OWNER" || member.role !== "ADMIN");
  const roles = myRole === "OWNER" ? ["ADMIN", "EDITOR", "REVIEWER"] : ["EDITOR", "REVIEWER"];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Invitar al equipo</h2>
        <p className="mt-1 text-sm text-stone-600">Genera un enlace privado, válido durante 48 horas y de un solo uso. Compártelo directamente con la persona invitada.</p>
        <form onSubmit={invite} className="mt-5 flex flex-wrap items-end gap-3">
          <label className="flex min-w-48 flex-1 flex-col gap-2 text-sm">Correo electrónico
            <input type="email" required value={email} onChange={event => setEmail(event.target.value)}
              className="rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-2 text-sm">Rol
            <select value={role} onChange={event => setRole(event.target.value)}
              className="rounded-lg border border-stone-300 px-3 py-2">
              {roles.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <button disabled={working} className="rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {working ? "Creando…" : "Crear invitación"}
          </button>
        </form>
        {inviteUrl && <div className="mt-4 rounded-lg bg-teal-50 p-4 text-sm">
          <p className="font-semibold">Enlace generado. Se muestra una sola vez:</p>
          <p className="mt-2 break-all">{inviteUrl}</p>
          <button type="button" onClick={() => navigator.clipboard.writeText(inviteUrl)}
            className="mt-3 rounded-lg border border-teal-700 px-3 py-2 text-teal-800">Copiar enlace</button>
        </div>}
      </section>
      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Miembros activos</h2>
        <div className="mt-4 space-y-3">
          {members.map(member => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-3">
            <div><p className="text-sm font-semibold">{member.displayName}</p><p className="text-xs text-stone-500">{member.email} · {member.role}</p></div>
            {canManage(member) && <div className="flex items-center gap-2">
              <select aria-label={`Rol de ${member.email}`} value={member.role}
                onChange={event => changeMember(member.id, event.target.value)}
                className="rounded-lg border border-stone-300 p-2 text-sm">
                {roles.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
              <button type="button" onClick={() => changeMember(member.id, null)}
                className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">Retirar</button>
            </div>}
          </div>)}
        </div>
      </section>
      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Invitaciones</h2>
        <div className="mt-4 space-y-3">
          {invitations.map(invite => <div key={invite.id} className="flex items-center justify-between gap-3 border-b border-stone-100 pb-3">
            <p className="text-sm">{invite.email} · {invite.role}
              <span className="block text-xs text-stone-500">{invite.acceptedAt ? "Aceptada" : invite.revokedAt ? "Revocada" : new Date(invite.expiresAt) <= new Date() ? "Caducada" : "Pendiente"}</span>
            </p>
            {!invite.acceptedAt && !invite.revokedAt && <button type="button" onClick={() => revokeInvite(invite.id)}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm">Revocar</button>}
          </div>)}
        </div>
      </section>
      {notice && <p role="status" className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">{notice}</p>}
    </div>
  );
}
