import { productionChecks } from "./production-checks.mjs";

const errors = productionChecks();
if (errors.length) {
  console.error("La configuración de producción no está lista:");
  for (const message of errors) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log("Configuración mínima verificada. Antes de desplegar, comprueba que prisma/dev.db está en un volumen persistente, realiza un respaldo recuperable y prueba OAuth, almacenamiento y publicación en el servidor.");
}
