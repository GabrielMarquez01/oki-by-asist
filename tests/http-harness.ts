import { afterEach, expect } from "vitest";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { crearServidor } from "../src/ui/server.js";
import { DemoUI } from "../src/ui/state.js";
import { PayPalSimulado, type CobrosPayPal } from "../src/paypal/index.js";
import { seleccionarRedactor, type RedactorSeleccionado } from "../src/agente/cobrar.js";
const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach(s => s.removeAllListeners()));
export async function iniciar(paypal = new PayPalSimulado() as CobrosPayPal, elegirRedactor: () => RedactorSeleccionado = () => seleccionarRedactor({})) {
  let demo: DemoUI;
  const server = crearServidor(() => (demo = new DemoUI("simulado", paypal, new Date(), elegirRedactor))); servers.push(server);
  // Invoke the actual HTTP handler in memory; no TCP socket in this sandbox.
  const request = (url: string, method = "GET", body = "", headers = {}): Promise<Response> => new Promise(resolve => {
    const req = Object.assign(Readable.from([body]), { url, method, headers: { host: "127.0.0.1:4173", ...headers } });
    let status = 200; const h: Record<string,string> = {};
    const res = { setHeader: (k: string,v: string) => h[k]=v,
      writeHead: (s: number, values = {}) => { status=s; Object.assign(h,values); },
      end: (d: string | Buffer) => resolve(new Response(d.toString(), { status, headers:h })) };
    server.emit("request", req as IncomingMessage, res as unknown as ServerResponse);
  });
  const post = async (accion: string, campos = {}) => {
    const res = await request("/api/accion", "POST", JSON.stringify({ accion,...campos }), { "content-type":"application/json" });
    return { status:res.status, body:await res.json() };
  };
  const recibir = async (muestra = "bueno") => (await post("recibir", { muestra })).body;
  const preparar = async () => {
    expect((await post("cobrar", { idioma:"es" })).status).toBe(200);
    expect((await post("enviar", { cuentaId:"DEMO-001" })).status).toBe(200);
  };
  return { request, post, recibir, preparar, demo: () => demo! };
}
