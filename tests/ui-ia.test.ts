import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { seleccionarRedactor, TOPE_IA_MS, type GeneradorBorrador, type EstadoBorrador } from "../src/agente/cobrar.js";
import { libroDemo } from "../src/libro/index.js";
import { PayPalSimulado } from "../src/paypal/index.js";
import { iniciar } from "./http-harness.js";

vi.mock("ai", async importOriginal => ({ ...await importOriginal<typeof import("ai")>(), generateText: vi.fn() }));
const llave = "llave-falsa-exclusiva-del-banco";
const env = { GOOGLE_GENERATIVE_AI_API_KEY: llave, OKI_GEMINI_MODEL: "gemini-modelo-falso" };
const url = "https://demo.invalid/pago/DEMO-001";
const cuenta = libroDemo().cuentas[0];
const copyModule = await import(new URL("../web/copy.js", import.meta.url).href);
const { copy, rotuloBorrador } = copyModule;
const valido: GeneradorBorrador = async ({ prompt }) => {
  const monto = prompt.match(/exact amount "([^"]+)"/)![1];
  const liga = prompt.match(/https:\/\/[^\s;.]+(?:\.[^\s;]+)*/)![0].replace(/\.$/, "");
  return `DEMO generado: ${monto} ${liga}`;
};
async function redactar(generar: GeneradorBorrador) {
  const s = seleccionarRedactor(env, generar);
  const mensaje = await s.redactor.redactar(cuenta, url, "cercano", "es");
  return { mensaje, estado: s.estado() };
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("UI IA: banco sin red", () => {
  it("sin llave usa plantilla aun si se ofrece un generador", async () => {
    const generar = vi.fn(valido);
    const s = seleccionarRedactor({}, generar);
    expect(await s.redactor.redactar(cuenta, url, "cercano", "es")).toContain("Hola Alma");
    expect(s.estado()).toEqual({ tipo: "plantilla" });
    expect(generar).not.toHaveBeenCalled();
    const { post } = await iniciar();
    const data = (await post("cobrar", { idioma: "es" })).body;
    expect(data.detalles["DEMO-001"].borrador).toEqual({ tipo: "plantilla" });
    expect(data.detalles["DEMO-001"].rotuloBorrador).toContain("no API key");
  });

  it("con llave recorre el generador SDK falso y guarda modelo, monto y liga", async () => {
    vi.mocked(generateText).mockImplementation(async input => ({ text: await valido({ modelo: "", prompt: input.prompt as string }) }) as Awaited<ReturnType<typeof generateText>>);
    const { post } = await iniciar(new PayPalSimulado(), () => seleccionarRedactor(env));
    const res = await post("cobrar", { idioma: "en" });
    expect(res.status).toBe(200);
    const d = res.body.detalles["DEMO-001"];
    expect(d.borrador).toEqual({ tipo: "ia_viva", modelo: env.OKI_GEMINI_MODEL });
    expect(d.mensaje).toContain("1200.00 MXN"); expect(d.mensaje).toContain(d.url);
    expect(d.rotuloBorrador).toContain(env.OKI_GEMINI_MODEL);
    expect(vi.mocked(generateText).mock.calls[0][0]).toMatchObject({ maxRetries: 0, model: { modelId: env.OKI_GEMINI_MODEL } });
    expect(vi.mocked(generateText).mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(res)).not.toContain(llave);
  });

  it("fallo de IA no tumba HTTP y acota el motivo sin registrar la llave", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { post, request } = await iniciar(new PayPalSimulado(), () => seleccionarRedactor(env, async () => {
        throw Object.assign(new Error(llave), { statusCode: 503, body: llave, url: llave });
      }));
      const res = await post("cobrar", { idioma: "es" });
      expect(res.status).toBe(200);
      expect(JSON.stringify(res)).not.toContain(llave);
      expect(res.body.detalles["DEMO-001"].borrador).toEqual({ tipo: "ia_no_disponible", motivo: "HTTP 503" });
      expect(res.body.detalles["DEMO-001"].mensaje).toContain("Hola Alma");
      const salidas = [JSON.stringify(res), JSON.stringify([log.mock.calls, error.mock.calls, warn.mock.calls])];
      for (const p of ["/", "/api/estado", "/copy.js", "/app.js"]) salidas.push(await (await request(p)).text());
      for (const salida of salidas) expect(salida).not.toContain(llave);
      expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
    } finally { log.mockRestore(); error.mockRestore(); warn.mockRestore(); }
  });

  it.each([
    ["sin liga", "DEMO 1200.00 MXN"],
    ["liga prefijo", `DEMO 1200.00 MXN ${url}/otro`],
    ["liga con consulta", `DEMO 1200.00 MXN ${url}?otro=1`],
    ["sin monto", `DEMO ${url}`],
    ["monto distinto", `DEMO 650.00 MXN ${url}`],
    ["monto como subcadena", `DEMO 11200.00 MXN ${url}`],
    ["monto negativo", `DEMO -1200.00 MXN ${url}`],
    ["centavos distintos", `DEMO 1200.01 MXN ${url}`],
    ["otro monto adicional", `DEMO 1200.00 MXN y $650.00 ${url}`],
    ["otra liga adicional", `DEMO 1200.00 MXN ${url} https://otro.invalid`],
    ...["650 pesos", "600 USD", "600 mxn", "MXN 600.00", "$1200.00 USD", "US$1200.00", "$1200.00", "EUR", "dólares", "dólar", "dolar", "DÓLAR", "_dólar_", "__dólares__", "__pesos__",
      "650 PESOS", "600 usd", "mxn 600.00", "$1200.00 usd", "us$1200.00", "eur", "DÓLARES", "dollars", "€", "GBP", "CHF",
      "1200.00 MXN USD", "+1200.00 MXN", "−1200.00 MXN", "–1200.00 MXN", "− 1200.00 MXN", "- 1200.00 MXN", "1,200.00 MXN"].map(otro => [`otro monto o moneda ${otro}`, `DEMO 1200.00 MXN ${url} o ${otro}`]),
    ...["$1200.00 USD", "US$1200.00", "$1200.00", "1200.00 mxn USD", "US$1200.00 MXN", "11200.00 MXN"].map(monto => [`sin canónico ${monto}`, `DEMO ${monto} ${url}`]),
    ...["HTTPS://otro.invalid", "www.otro.invalid/pagar", "otro.invalid/pagar", "HTTPS://OTRO.INVALID", "WWW.OTRO.INVALID/PAGAR", "ftp://otro.invalid/pagar"].map(liga => [`otra liga ${liga}`, `DEMO 1200.00 MXN ${url} ${liga}`]),
  ])("descarta borrador: %s", async (_caso, borrador) => {
    const data = await redactar(async () => borrador);
    expect(data.estado).toEqual({ tipo: "ia_no_disponible", motivo: "invalid payment details" });
    expect(data.mensaje).toContain("Hola Alma"); expect(data.mensaje).toContain("$1200.00 MXN"); expect(data.mensaje).toContain(url);
  });

  it.each(["1200.00 MXN", "$1200.00 MXN", "1200.00 mxn"])("acepta solo el monto canónico: %s", async monto => {
    const borrador = `DEMO ${monto} ${url}`;
    const data = await redactar(async () => borrador);
    expect(data.estado).toEqual({ tipo: "ia_viva", modelo: env.OKI_GEMINI_MODEL });
    expect(data.mensaje).toBe(borrador);
  });

  it.each([".", ",", ";", ":", "!", "?", ")", "]", "}"])("acepta puntuación pegada a la liga exacta: %s", async puntuacion => {
    const borrador = `DEMO $1200.00 MXN: (${url}${puntuacion}`;
    const data = await redactar(async () => borrador);
    expect(data.estado.tipo).toBe("ia_viva");
    expect(data.mensaje).toBe(borrador);
  });

  it("el formato conservador descarta cifras no monetarias adicionales", async () => {
    const data = await redactar(async () => `DEMO 1200.00 MXN ${url} vence el 10`);
    expect(data.estado.tipo).toBe("ia_no_disponible");
  });

  it("rechaza la llave incluso dentro de un texto con liga y monto válidos", async () => {
    const data = await redactar(async () => `DEMO 1200.00 MXN ${url} ${llave}`);
    expect(data.estado).toEqual({ tipo: "ia_no_disponible", motivo: "unsafe draft" });
    expect(JSON.stringify(data)).not.toContain(llave);
  });

  it("error no HTTP y status fuera de rango no copian texto arbitrario", async () => {
    for (const statusCode of [llave, 123456789, NaN, 200.5, undefined]) {
      const data = await redactar(async () => { throw { message: llave, statusCode }; });
      expect(data.estado).toEqual({ tipo: "ia_no_disponible", motivo: "request failed" });
      expect(JSON.stringify(data)).not.toContain(llave);
    }
  });

  it("corta a los 20 s, aborta y una respuesta tardía no cambia el estado", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined; let completar!: (s: string) => void;
    const s = seleccionarRedactor(env, input => { signal = input.abortSignal; return new Promise(resolve => { completar = resolve; }); });
    const promesa = s.redactor.redactar(cuenta, url, "cercano", "es");
    expect(s.estado()).toEqual({ tipo: "pendiente" });
    await vi.advanceTimersByTimeAsync(TOPE_IA_MS - 1);
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await promesa).toContain("Hola Alma"); expect(signal!.aborted).toBe(true);
    expect(s.estado()).toEqual({ tipo: "ia_no_disponible", motivo: "timeout" });
    completar(`DEMO 1200.00 MXN ${url}`); await Promise.resolve();
    expect(s.estado().tipo).toBe("ia_no_disponible"); expect(vi.getTimerCount()).toBe(0);
  });

  it("el corte de ambos cobros devuelve HTTP 200 y conserva la pantalla", async () => {
    vi.useFakeTimers();
    const { post } = await iniciar(new PayPalSimulado(), () => seleccionarRedactor(env, () => new Promise(() => {})));
    const respuesta = post("cobrar", { idioma: "es" });
    await vi.advanceTimersByTimeAsync(TOPE_IA_MS * 2 + 1);
    const res = await respuesta;
    expect(res.status).toBe(200);
    expect(res.body.detalles["DEMO-001"].borrador.motivo).toBe("timeout");
    expect(res.body.detalles["DEMO-002"].borrador.motivo).toBe("timeout");
  });

  it.each([false, true])("rótulo por cobro: fallo primero=%s; otro éxito no lo contamina", async falloPrimero => {
    let n = 0;
    const { post, demo } = await iniciar(new PayPalSimulado(), () => seleccionarRedactor(env, async input => {
      const falla = (n++ === 0) === falloPrimero;
      if (falla) throw new Error(llave);
      return valido(input);
    }));
    const data = (await post("cobrar", { idioma: "es" })).body;
    const primero = data.detalles["DEMO-001"], segundo = data.detalles["DEMO-002"];
    expect(primero.borrador.tipo).toBe(falloPrimero ? "ia_no_disponible" : "ia_viva");
    expect(segundo.borrador.tipo).toBe(falloPrimero ? "ia_viva" : "ia_no_disponible");
    for (const idioma of ["es", "en"] as const) {
      const snapshot = demo().estado(idioma);
      expect(snapshot.detalles["DEMO-001"].rotuloBorrador).toContain(falloPrimero ? (idioma === "es" ? "plantilla" : "template") : env.OKI_GEMINI_MODEL);
    }
    await post("cobrar", { idioma: "en" });
    expect(demo().detalles["DEMO-001"].borrador).toEqual(primero.borrador);
  });

  it("IA solo redacta: saldos intactos hasta la aprobación del dueño", async () => {
    const { post, recibir, demo } = await iniciar(new PayPalSimulado(), () => seleccionarRedactor(env, valido));
    await post("cobrar", { idioma: "es" });
    expect(demo().libro.cuentas[0]).toMatchObject({ monto: 1200, saldo: 1200, estado: "por_confirmar" });
    expect(demo().historial.some(h => h.paso === "record_payment_for_invoice")).toBe(false);
    await post("enviar", { cuentaId: "DEMO-001" }); await recibir();
    expect(demo().libro.cuentas[0].saldo).toBe(1200);
    await post("aprobar", { id: demo().recibos[0].conciliacion.id });
    expect(demo().libro.cuentas[0].saldo).toBe(600);
  });

  it.each(["es", "en"])("copy %s distingue los tres resultados y lector sin IA", idioma => {
    const plantilla = rotuloBorrador({ tipo: "plantilla" }, idioma);
    const vivo = rotuloBorrador({ tipo: "ia_viva", modelo: "gemini-modelo-falso" }, idioma);
    const fallo = rotuloBorrador({ tipo: "ia_no_disponible", motivo: "invalid payment details" }, idioma);
    expect(new Set([plantilla, vivo, fallo]).size).toBe(3);
    expect(plantilla).toMatch(/sin llave|no API key/); expect(vivo).toContain("gemini-modelo-falso");
    expect(fallo).toMatch(/se usó plantilla|template used/); expect(fallo).toMatch(/liga o monto|link or amount/);
    expect(rotuloBorrador(undefined, idioma)).toMatch(/sin generar|not generated/);
    expect(copy[idioma].loading).toBe(idioma === "es" ? "Procesando la operación…" : "Processing the operation…");
    expect(copy[idioma].reading).toMatch(/sin IA|no AI/); expect(copy[idioma].lanes[0]).toMatch(/sin IA|no AI/);
  });
});

// Run the shipped browser code with a small DOM facade. This checks both actual
// placements (account and chat), escaping and language changes without sockets.
async function pantalla(estado: EstadoBorrador) {
  const { request, post } = await iniciar(); await post("cobrar", { idioma: "es" });
  const data = await (await request("/api/estado")).json();
  data.detalles["DEMO-001"].borrador = estado; data.detalles["DEMO-001"].enviado = true;
  type Nodo = { innerHTML: string; textContent: string; addEventListener: (event: string, fn: () => void) => void };
  const nodos = new Map<string, Nodo>(); const eventos = new Map<string, (event?: unknown) => unknown>();
  const getElementById = (id: string) => {
    if (!nodos.has(id)) nodos.set(id, { innerHTML: "", textContent: "", addEventListener: (evento, fn) => { eventos.set(`${id}:${evento}`, fn); } });
    return nodos.get(id)!;
  };
  const document = { body: {}, documentElement: {}, activeElement: null, getElementById,
    addEventListener: (event: string, fn: (e: unknown) => unknown) => eventos.set(event, fn), querySelectorAll: () => [] };
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8").replace(/^import[^;]+;/, "");
  await runInNewContext(`(async () => { ${app} })()`, { document, C: copy, rotuloBorrador, URL,
    fetch: async () => ({ ok: true, json: async () => data }) });
  await eventos.get("click")!({ target: { closest: () => ({ dataset: { action: "account", id: "DEMO-001" } }) } });
  return { nodos, cambiarIdioma: () => eventos.get("language:click")!() };
}

describe("rótulos del script web entregado (DOM en memoria, sin sockets)", () => {
  it.each<EstadoBorrador>([
    { tipo: "plantilla" }, { tipo: "ia_viva", modelo: "gemini-modelo-falso" },
    { tipo: "ia_no_disponible", motivo: "invalid payment details" },
  ])("cuenta y chat usan el estado concreto $tipo en EN y ES", async estado => {
    const { nodos, cambiarIdioma } = await pantalla(estado);
    for (const idioma of ["en", "es"]) {
      const esperado = rotuloBorrador(estado, idioma);
      expect(nodos.get("view")!.innerHTML).toContain(esperado);
      expect(nodos.get("client")!.innerHTML).toContain(esperado);
      cambiarIdioma();
    }
  });
});
