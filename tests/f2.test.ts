import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgenteConciliador } from "../src/agente/conciliar.js";
import { empatarComprobante } from "../src/comprobantes/empatar.js";
import { modeloLectorComprobante, type LecturaComprobante } from "../src/comprobantes/lector.js";
import { cargarTransferencias } from "../src/config/transferencias.js";
import { libroDemo } from "../src/libro/index.js";
import { PayPalSimulado, type CobrosPayPal } from "../src/paypal/index.js";
import { politicaDemo } from "../src/politica.js";

const fecha = "2026-11-04";
function lectura(cambios: Partial<LecturaComprobante> = {}): LecturaComprobante {
  return { monto: 600, moneda: "MXN", fecha, metodo: "spei", referencia: "DEMO-001 transferencia", banco: "Banco DEMO", cuentaBeneficiaria: politicaDemo.cuentasCobro[0], confianza: 0.99, demo: true, ...cambios };
}
async function listo(): Promise<{ libro: ReturnType<typeof libroDemo>; paypal: PayPalSimulado }> {
  const libro = libroDemo(new Date(`${fecha}T12:00:00Z`)); const paypal = new PayPalSimulado();
  const cuenta = libro.cuentas[0]; cuenta.paypalInvoiceId = (await paypal.crear({ referencia: cuenta.id, monto: cuenta.monto, permitirParcial: true, minimoParcialPct: 30 })).id; cuenta.estado = "por_confirmar";
  return { libro, paypal };
}

describe("F2 conciliación", () => {
  it("empate correcto queda por confirmar", async () => {
    const { libro } = await listo(); expect(empatarComprobante("CON-1", lectura(), libro, politicaDemo).estado).toBe("por_confirmar");
  });
  it.each([
    ["monto mayor", lectura({ monto: 1201 }), [], "monto_distinto_o_mayor_al_saldo"],
    ["referencia ya usada", lectura(), ["DEMO-001 transferencia"], "referencia_ya_usada"],
    ["fecha fuera", lectura({ fecha: "2026-12-04" }), [], "fecha_fuera_de_ventana"],
    ["confianza baja", lectura({ confianza: 0.2 }), [], "confianza_baja"],
    ["sin candidato", lectura({ referencia: "SIN-COBRO" }), [], "ningun_cobro_candidato"],
  ])("marca sospechoso: %s", async (_nombre, comprobante, usadas, motivo) => {
    const { libro } = await listo(); const resultado = empatarComprobante("CON-X", comprobante, libro, politicaDemo, usadas);
    expect(resultado).toMatchObject({ estado: "sospechoso", motivo });
  });
  it("marca sospechoso si hay más de un candidato", async () => {
    const { libro } = await listo(); const segunda = libro.cuentas[1]; segunda.estado = "por_confirmar"; segunda.saldo = 650; segunda.vencimiento = fecha;
    const resultado = empatarComprobante("CON-2", lectura({ referencia: "DEMO-001 DEMO-002" }), libro, politicaDemo);
    expect(resultado).toMatchObject({ estado: "sospechoso", motivo: "mas_de_un_candidato" });
  });
  it("sin aprobación no llama record_payment_for_invoice", async () => {
    const { libro, paypal } = await listo(); const agente = new AgenteConciliador(libro, paypal);
    const conciliacion = empatarComprobante("CON-3", lectura(), libro, politicaDemo);
    expect(libro.cuentas[0].saldo).toBe(1200); expect(conciliacion.estado).toBe("por_confirmar"); expect(await paypal.consultar(libro.cuentas[0].paypalInvoiceId ?? "")).toMatchObject({ status: "DRAFT" });
    void agente;
  });
  it("un sospechoso exige revisión explícita del dueño", async () => {
    const { libro, paypal } = await listo(); const agente = new AgenteConciliador(libro, paypal);
    const sospechoso = empatarComprobante("CON-REV", lectura(), libro, politicaDemo, ["DEMO-001 transferencia"]);
    await expect(agente.aprobar(sospechoso)).rejects.toThrow("aprobarRevisado"); expect(libro.cuentas[0].saldo).toBe(1200);
    await agente.aprobarRevisado(sospechoso); expect(sospechoso.revisadoPorDueno).toBe(true); expect(libro.cuentas[0].saldo).toBe(600);
  });
  it("la aprobación usa monto exacto, transferencia y deja parcial", async () => {
    const { libro, paypal } = await listo(); const llamadas: Array<{ monto: number; metodo: string; fecha: string }> = [];
    const espia: CobrosPayPal = {
      crear: (input) => paypal.crear(input), enviar: (id) => paypal.enviar(id), qr: (id) => paypal.qr(id), consultar: (id) => paypal.consultar(id),
      registrarPagoExterno: async (id, pago) => { llamadas.push(pago); await paypal.registrarPagoExterno(id, pago); },
    };
    const agente = new AgenteConciliador(libro, espia);
    const conciliacion = empatarComprobante("CON-4", lectura(), libro, politicaDemo); await agente.aprobar(conciliacion);
    expect(llamadas).toEqual([{ monto: 600, metodo: "BANK_TRANSFER", fecha }]); expect(conciliacion.estado).toBe("parcial"); expect(libro.cuentas[0]).toMatchObject({ saldo: 600, estado: "parcial" });
  });
  it("un error de PayPal deja error sin cambiar saldo", async () => {
    const { libro } = await listo(); const errorPayPal: CobrosPayPal = { crear: async () => { throw new Error("no"); }, enviar: async () => ({}), qr: async () => ({ href: "https://demo.local" }), consultar: async () => { throw new Error("PayPal falló"); }, registrarPagoExterno: async () => { throw new Error("PayPal falló"); } };
    const agente = new AgenteConciliador(libro, errorPayPal); const conciliacion = empatarComprobante("CON-5", lectura(), libro, politicaDemo); await agente.aprobar(conciliacion);
    expect(conciliacion.estado).toBe("error"); expect(libro.cuentas[0].saldo).toBe(1200);
  });
  it("rechaza configuración inválida", () => {
    const ruta = join(tmpdir(), "oki-transferencias-invalida.json"); writeFileSync(ruta, '{"metodos":[{"id":"sin-referencia","nombre":"x","campos":[]}]}'); expect(() => cargarTransferencias(ruta)).toThrow("Configuración de transferencias inválida");
  });
  it("lector real usa el modelo Gemini central, no OKI_MODELO_VISION", () => {
    expect(modeloLectorComprobante({ OKI_MODELO_VISION: "modelo-obsoleto", OKI_GEMINI_MODEL: "modelo-central" })).toBe("modelo-central");
  });
  it.fails("control mutante: un empate roto no acepta monto mayor al saldo", () => {
    const empateRoto = (monto: number, saldo: number): boolean => monto >= 0 && saldo >= 0;
    expect(empateRoto(1201, 1200)).toBe(false);
  });
});
