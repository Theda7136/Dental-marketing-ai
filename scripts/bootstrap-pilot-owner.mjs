import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const [emailInput, ...nameParts] = process.argv.slice(2);
const email = emailInput?.trim().toLowerCase();
const displayName = nameParts.join(" ").trim();
const password = process.env.DENTAL_OWNER_PASSWORD;
delete process.env.DENTAL_OWNER_PASSWORD;

if (!email || !/^\S+@\S+\.\S+$/.test(email) || !displayName ||
    !password || password.length < 16 || password.length > 256) {
  console.error("Uso: DENTAL_OWNER_PASSWORD=<clave segura> node scripts/bootstrap-pilot-owner.mjs correo@clinica.com Nombre Apellido");
  console.error("Se requieren email, nombre completo y DENTAL_OWNER_PASSWORD (16–256 caracteres).");
  process.exitCode = 1;
} else {
  const prisma = new PrismaClient();
  try {
    const salt = randomBytes(16);
    const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    const passwordHash = `scrypt:16384:${salt.toString("hex")}:${key.toString("hex")}`;
    const owner = await prisma.$transaction(async (tx) => {
      const clinic = await tx.clinic.findUnique({ where: { id: "pilot" } });
      if (!clinic) throw new Error("No existe la clínica piloto. Ejecuta las migraciones Prisma.");
      const existingOwner = await tx.clinicMembership.findFirst({
        where: { clinicId: "pilot", role: "OWNER" },
      });
      if (existingOwner) throw new Error("La clínica piloto ya tiene propietario. No se puede crear otro con este comando.");
      const existingUser = await tx.studioUser.findUnique({ where: { email } });
      if (existingUser) throw new Error("Este correo ya está registrado.");

      const user = await tx.studioUser.create({
        data: { email, displayName, passwordHash },
      });
      await tx.clinicMembership.create({
        data: { clinicId: "pilot", userId: user.id, role: "OWNER" },
      });
      return user.email;
    });
    console.log(`Propietario creado: ${owner}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "No se pudo crear el propietario.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
