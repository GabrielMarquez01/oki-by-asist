import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { cobrarVencidas, RedactorPlantilla } from "../src/agente/cobrar.js";
import { AgenteConciliador } from "../src/agente/conciliar.js";
import { empatarComprobante, type Conciliacion } from "../src/comprobantes/empatar.js";
import { LectorComprobanteSimulado, LecturaComprobanteSchema } from "../src/comprobantes/lector.js";
import { libroDemo, type Libro } from "../src/libro/index.js";
import { PayPalSimulado } from "../src/paypal/index.js";
import { politicaDemo } from "../src/politica.js";

vi.mock("../src/agente/cobrar.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/agente/cobrar.js")>();
  return { ...original, seleccionarRedactor: () => original.seleccionarRedactor({}) };
});

const fechaRelativa = (hoy: Date, dias: number) => new Date(hoy.getTime() + dias * 86400000).toISOString().slice(0, 10);
async function ejecutarDemo(hoy?: string): Promise<string> {
  const salida: string[] = []; const errores: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...partes) => { salida.push(partes.join(" ")); });
  const error = vi.spyOn(console, "error").mockImplementation((...partes) => { errores.push(partes.join(" ")); });
  const exitCode = process.exitCode;
  vi.stubEnv("OKI_HOY", hoy); vi.stubEnv("OKI_LANG", "en");
  vi.spyOn(process, "argv", "get").mockReturnValue([process.execPath, "src/cli.ts"]);
  try {
    vi.resetModules();
    await import("../src/cli.js");
    await vi.waitFor(() => expect(salida.some((linea) => linea.startsWith("LEDGER_AFTER_JSON ")) || errores.length > 0).toBe(true));
    if (errores.length > 0) throw new Error(errores.join("\n"));
    return salida.join("\n");
  } finally {
    log.mockRestore(); error.mockRestore();
    vi.restoreAllMocks(); vi.unstubAllEnvs(); process.exitCode = exitCode;
  }
}
function conciliacionDe(salida: string, etiqueta: string): Conciliacion {
  const coincidencia = salida.match(new RegExp(`${etiqueta} (.+)`));
  expect(coincidencia, salida).not.toBeNull();
  return JSON.parse(coincidencia![1]) as Conciliacion;
}
function comprobarBueno(conciliacion: Conciliacion): void {
  expect(conciliacion).toMatchObject({ estado: "por_confirmar", cuentaId: "DEMO-001" });
  expect(conciliacion.motivo).toBeUndefined();
}
function comprobarDemo(salida: string): void {
  comprobarBueno(conciliacionDe(salida, "GOOD_RECEIPT_JSON"));
  expect(conciliacionDe(salida, "OWNER_APPROVAL_JSON")).toMatchObject({ estado: "parcial", cuentaId: "DEMO-001" });
  expect(conciliacionDe(salida, "SUSPICIOUS_RECEIPT_JSON")).toMatchObject({ estado: "sospechoso", motivo: "referencia_ya_usada" });
  const coincidencia = salida.match(/LEDGER_AFTER_JSON ([\s\S]+)$/);
  expect(coincidencia).not.toBeNull();
  const libro = JSON.parse(coincidencia![1]) as Libro;
  expect(libro.cuentas[0]).toMatchObject({ estado: "parcial", saldo: 600 });
  expect(libro.cuentas[1].estado).toBe("por_confirmar");
}

describe("demo con fechas relativas", () => {
  it.each(["2026-11-05", "2026-11-15", "2026-12-31", "2027-06-30"])("CLI completo con OKI_HOY=%s", async (fecha) => {
    const salida = await ejecutarDemo(fecha);
    comprobarDemo(salida);
    const hoy = new Date(`${fecha}T00:00:00Z`);
    for (const etiqueta of ["GOOD_RECEIPT_JSON", "SUSPICIOUS_RECEIPT_JSON"]) {
      expect(conciliacionDe(salida, etiqueta).lectura.fecha).toBe(fechaRelativa(hoy, -1));
    }
    expect(salida).toContain(`"vencimiento": "${fechaRelativa(hoy, -3)}"`);
  }, 20000);

  it("CLI sin OKI_HOY conserva el reloj actual", async () => {
    const antes = new Date();
    const salida = await ejecutarDemo();
    const despues = new Date();
    comprobarDemo(salida);
    expect([fechaRelativa(antes, -1), fechaRelativa(despues, -1)]).toContain(conciliacionDe(salida, "GOOD_RECEIPT_JSON").lectura.fecha);
  }, 20000);

  it.each(["2026-02-30", "05-11-2026", ""])("rechaza OKI_HOY inválido: %s", async (fecha) => {
    await expect(ejecutarDemo(fecha)).rejects.toThrow("Invalid date");
  }, 20000);

  it("el lector conserva el mismo hoy aunque cruce medianoche UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-12-31T23:59:59.999Z"));
      const lector = new LectorComprobanteSimulado();
      const libro = libroDemo();
      vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
      const bueno = await lector.leer("fixtures/comprobantes/bueno.json");
      const dudoso = await lector.leer("fixtures/comprobantes/dudoso.json");
      expect(bueno.fecha).toBe("2026-12-30");
      expect(dudoso.fecha).toBe(bueno.fecha);
      comprobarBueno(empatarComprobante("CON-RELOJ", bueno, libro, politicaDemo));
    } finally { vi.useRealTimers(); }
  });

  it("cobro y conciliación conservan el resultado durante los 365 días del contrato", async () => {
    for (let dia = 0; dia < 365; dia++) {
      const hoy = new Date(Date.parse("2026-11-05T00:00:00Z") + dia * 86400000);
      const libro = libroDemo(hoy); const paypal = new PayPalSimulado();
      await cobrarVencidas(libro, paypal, politicaDemo, new RedactorPlantilla(), "en");
      const lector = new LectorComprobanteSimulado(hoy); const agente = new AgenteConciliador(libro, paypal);
      const bueno = empatarComprobante("CON-BUENO", await lector.leer("fixtures/comprobantes/bueno.json"), libro, politicaDemo, agente.referenciasUsadas);
      comprobarBueno(bueno);
      await agente.aprobar(bueno);
      expect(bueno.estado).toBe("parcial");
      expect(libro.cuentas[0].saldo).toBe(600);
      const dudoso = empatarComprobante("CON-DUDOSO", await lector.leer("fixtures/comprobantes/dudoso.json"), libro, politicaDemo, agente.referenciasUsadas);
      expect(dudoso).toMatchObject({ estado: "sospechoso", motivo: "referencia_ya_usada" });
    }
  });

  it("control mutante: la fecha fija anterior hace FALLAR el contrato el 2026-11-15", () => {
    const fijo = LecturaComprobanteSchema.parse(JSON.parse(readFileSync(new URL("../fixtures/comprobantes/bueno.json", import.meta.url), "utf8")));
    expect(fijo.fecha).toBe("2026-11-04");
    const resultado = empatarComprobante("CON-MUTANTE", fijo, libroDemo(new Date("2026-11-15T00:00:00Z")), politicaDemo);
    expect(resultado).toMatchObject({ estado: "sospechoso", motivo: "fecha_fuera_de_ventana" });
    expect(() => comprobarBueno(resultado)).toThrow();
  });
});
