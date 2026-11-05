import { crearServidor } from "./server.js";
const puerto = Number(process.env.OKI_UI_PORT ?? 4173);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error("OKI_UI_PORT: invalid port");
try {
  const server = crearServidor();
  server.on("error", (error: NodeJS.ErrnoException) => { console.error(`UI: ${error.code ?? "SERVER_ERROR"} · 127.0.0.1:${puerto}`); process.exitCode = 1; });
  server.listen(puerto, "127.0.0.1", () => console.log(`UI DEMO http://127.0.0.1:${puerto}`));
} catch { console.error("UI: check PayPal SANDBOX configuration"); process.exitCode = 1; }
