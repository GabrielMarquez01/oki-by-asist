import { AccionSchema } from "./actions.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { idiomaActual } from "../i18n.js";
import { crearProveedor, DemoUI, ErrorUI } from "./state.js";

const raiz = fileURLToPath(new URL("../../", import.meta.url));
const archivos: Record<string, [string, string]> = {
  "/": ["web/index.html", "text/html; charset=utf-8"],
  "/app.js": ["web/app.js", "text/javascript; charset=utf-8"],
  "/copy.js": ["web/copy.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["web/styles.css", "text/css; charset=utf-8"],
  "/brand.png": ["assets/brand/oki-by-asist-banner.png", "image/png"],
};
async function cuerpo(req: IncomingMessage): Promise<unknown> {
  let datos = "";
  for await (const parte of req) {
    datos += parte; if (Buffer.byteLength(datos) > 2048) throw new ErrorUI("invalid", 413);
  }
  try { return JSON.parse(datos); } catch { throw new ErrorUI("invalid", 400); }
}
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data));
}
export function crearServidor(fabrica = () => {
  const { modo, paypal } = crearProveedor(); return new DemoUI(modo, paypal);
}) {
  let demo = fabrica(); let cola: Promise<unknown> = Promise.resolve();
  const exclusivo = <T>(operacion: () => Promise<T>): Promise<T> => {
    const siguiente = cola.then(operacion); cola = siguiente.catch(() => undefined); return siguiente;
  };
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      const host = req.headers.host ?? "";
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new ErrorUI("origin", 403);
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (req.method === "GET" && url.pathname === "/api/estado") {
        await cola; json(res, 200, demo.estado()); return;
      }
      if (req.method === "POST" && url.pathname === "/api/accion") {
        if ((req.headers.origin && req.headers.origin !== `http://${host}`)
          || req.headers["sec-fetch-site"] === "cross-site") throw new ErrorUI("origin", 403);
        if (!req.headers["content-type"]?.startsWith("application/json")) throw new ErrorUI("invalid", 415);
        const parsed = AccionSchema.safeParse(await cuerpo(req));
        if (!parsed.success) throw new ErrorUI("invalid", 400);
        await exclusivo(async () => {
          const a = parsed.data;
          switch (a.accion) {
            case "cobrar": await demo.cobrar(a.idioma); break;
            case "enviar": demo.enviar(a.cuentaId); break;
            case "recibir": await demo.recibir(a.muestra); break;
            case "aprobar": await demo.aprobar(a.id, a.revisado, a.confirmado); break;
            case "rechazar": demo.rechazar(a.id); break;
            case "reiniciar": demo = fabrica(); break;
          }
        });
        json(res, 200, demo.estado()); return;
      }
      const archivo = archivos[url.pathname];
      if (req.method !== "GET" || !archivo) throw new ErrorUI("missing", 404);
      let contenido = await readFile(resolve(raiz, archivo[0]));
      if (url.pathname === "/") {
        const modo = demo.modo === "sandbox" ? "sandbox" : idiomaActual() === "es" ? "simulado" : "simulated";
        contenido = Buffer.from(contenido.toString().replace('>DEMO</strong>', `>DEMO · PayPal ${modo}</strong>`));
      }
      res.writeHead(200, { "Content-Type": archivo[1] }); res.end(contenido);
    } catch (error) {
      const conocido = error instanceof ErrorUI;
      json(res, conocido ? error.status : 500, { error: conocido ? error.codigo : "internal", idioma: idiomaActual() });
    }
  });
}
