import { pathToFileURL } from "node:url";

export async function smokeTest(baseUrl, request = fetch) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Indica un origen HTTPS sin rutas ni credenciales.");
  }

  const health = await request(new URL("/api/health", origin), {
    redirect: "manual",
    signal: AbortSignal.timeout(12_000),
  });
  if (health.status !== 200) throw new Error(`Health HTTP ${health.status}`);
  if ((health.headers.get("content-type") || "").split(";")[0] !== "application/json") {
    throw new Error("Health no devolvió JSON.");
  }
  const payload = await health.json();
  if (!payload || payload.status !== "ok" || Object.keys(payload).length !== 1) {
    throw new Error("Health devolvió información inesperada.");
  }

  const privatePage = await request(new URL("/dashboard", origin), {
    redirect: "manual",
    signal: AbortSignal.timeout(12_000),
  });
  const location = privatePage.headers.get("location") || "";
  if (![302, 303, 307, 308].includes(privatePage.status) ||
      !new URL(location, origin).pathname.startsWith("/login")) {
    throw new Error("El panel sin sesión no redirige al inicio de sesión.");
  }
  return { health: "ok", anonymousDashboard: "protected" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error("Uso: node scripts/smoke-production.mjs https://tu-dominio.com");
    process.exitCode = 1;
  } else {
    try {
      const status = await smokeTest(baseUrl);
      console.log("Prueba de humo superada:", status);
    } catch (error) {
      console.error("Prueba de humo fallida:", error instanceof Error ? error.message : "Error desconocido.");
      process.exitCode = 1;
    }
  }
}
