import { describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({ llamada: 0, falloPrimero: true }));
vi.mock("../src/agente/cobrar.js", async importOriginal => {
  const original = await importOriginal<typeof import("../src/agente/cobrar.js")>();
  return { ...original, seleccionarRedactor: () => original.seleccionarRedactor({
    GOOGLE_GENERATIVE_AI_API_KEY: "llave-cli-sintetica", OKI_GEMINI_MODEL: "gemini-cli-falso",
  }, async ({ prompt }) => {
    if ((control.llamada++ === 0) === control.falloPrimero) throw new Error("llave-cli-sintetica");
    const monto = prompt.match(/exact amount "([^"]+)"/)![1];
    const url = prompt.match(/https:\/\/\S+/)![0].replace(/\.$/, "");
    return `DEMO generado ${monto} ${url}`;
  }) };
});

describe("CLI: mismo origen por mensaje que en UI", () => {
  it.each(["es", "en"])("%s: una plantilla no hereda IA del siguiente cobro", async idioma => {
    for (const falloPrimero of [true, false]) {
      const salida: string[] = []; const errores: string[] = [];
      control.llamada = 0; control.falloPrimero = falloPrimero;
      const log = vi.spyOn(console, "log").mockImplementation((...args) => { salida.push(args.join(" ")); });
      const error = vi.spyOn(console, "error").mockImplementation((...args) => { errores.push(args.join(" ")); });
      vi.spyOn(process, "argv", "get").mockReturnValue([process.execPath, "src/cli.ts"]);
      vi.stubEnv("OKI_LANG", idioma); vi.stubEnv("OKI_HOY", "2026-11-08");
      const exitCode = process.exitCode;
      try {
        vi.resetModules(); await import("../src/cli.js");
        await vi.waitFor(() => expect(salida.some(linea => linea.startsWith("LEDGER_AFTER_JSON")) || errores.length > 0).toBe(true));
        expect(errores).toEqual([]);
        const mensajes = salida.filter(linea => linea.includes("DEMO generado") || linea.includes("Hola Alma") || linea.includes("Hello Alma") || linea.includes("Hola Bruno") || linea.includes("Hello Bruno"));
        expect(mensajes).toHaveLength(2);
        expect(mensajes[falloPrimero ? 0 : 1]).toMatch(/usando plantilla|using template/);
        expect(mensajes[falloPrimero ? 1 : 0]).toContain("gemini-cli-falso");
        expect(salida.join("\n")).not.toContain("llave-cli-sintetica");
      } finally {
        log.mockRestore(); error.mockRestore(); vi.restoreAllMocks(); vi.unstubAllEnvs(); process.exitCode = exitCode;
      }
    }
  });
});
