import { cobrarVencidas, seleccionarRedactor, type EstadoBorrador } from "./agente/cobrar.js";
import { consultarCobros } from "./agente/consultar.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { libroDemo } from "./libro/index.js";
import { PayPalReal, PayPalSimulado } from "./paypal/index.js";
import { politicaDemo } from "./politica.js";
import { LectorComprobanteSimulado } from "./comprobantes/lector.js";
import { empatarComprobante } from "./comprobantes/empatar.js";
import { AgenteConciliador } from "./agente/conciliar.js";
import { cargarTransferencias } from "./config/transferencias.js";
import { idiomaActual, texto } from "./i18n.js";
import { z } from "zod";

const sandbox = process.argv.includes("--sandbox");
const grabar = process.argv.includes("--grabar");
function sanitizar(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizar);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|email|(?:client|customer|payer).*id/i.test(key) ? "[REDACTADO]" : sanitizar(item)]));
  }
  return value;
}
function grabadora(nombre: string, respuesta: unknown): void {
  writeFileSync(join("fixtures", `${nombre}.json`), `${JSON.stringify({ _origen: "sandbox_sanitizado", respuesta: sanitizar(respuesta) }, null, 2)}\n`);
}
async function main(): Promise<void> {
  const idioma = idiomaActual(); const t = texto(idioma);
  const transferencias = cargarTransferencias();
  console.log(t.transferMethods, transferencias.metodos.map((metodo) => metodo.id).join(", "));
  const hoy = process.env.OKI_HOY === undefined ? new Date() : new Date(`${z.string().date().parse(process.env.OKI_HOY)}T00:00:00Z`);
  const libro = libroDemo(hoy);
  if (sandbox) libro.cuentas[1].estado = "pendiente";
  // En sandbox, los ids sintéticos del libro demo (INV-DEMO-*) no existen en PayPal: get_invoice da 404 (medido 2026-11-04).
  if (sandbox) for (const cuenta of libro.cuentas) if (cuenta.paypalInvoiceId?.startsWith("INV-DEMO")) delete cuenta.paypalInvoiceId;
  console.log(t.ledgerBefore); libro.cuentas.forEach((cuenta) => console.log(t.summary(cuenta)));
  console.log("LEDGER_BEFORE_JSON", JSON.stringify(libro, null, 2));
  const paypal = sandbox ? new PayPalReal(process.env.PAYPAL_CLIENT_ID ?? "", process.env.PAYPAL_CLIENT_SECRET ?? "", grabar ? grabadora : undefined) : new PayPalSimulado();
  const redactor = seleccionarRedactor();
  const borradores: EstadoBorrador[] = [];
  const mensajes = await cobrarVencidas(libro, paypal, politicaDemo, {
    redactar: async (cuenta, url, tono, lang) => {
      const mensaje = await redactor.redactor.redactar(cuenta, url, tono, lang);
      borradores.push(redactor.estado());
      return mensaje;
    },
  }, idioma);
  if (sandbox) {
    const invoiceId = libro.cuentas[0].paypalInvoiceId;
    if (!invoiceId) {
      const motivo = libro.cuentas[0].motivoError;
      if (motivo) { console.error(t.sandboxReason); console.error("ERROR_JSON", JSON.stringify({ message: motivo })); }
      throw new Error(t.sandboxMissing);
    }
    await paypal.registrarPagoExterno(invoiceId, { monto: libro.cuentas[0].monto * 0.4, metodo: "BANK_TRANSFER", fecha: hoy.toISOString().slice(0, 10) });
    await consultarCobros(libro, paypal);
  } else {
    const lector = new LectorComprobanteSimulado(hoy); const agente = new AgenteConciliador(libro, paypal);
    const bueno = await lector.leer("fixtures/comprobantes/bueno.json");
    const conciliacionBuena = empatarComprobante("CON-DEMO-001", bueno, libro, politicaDemo, agente.referenciasUsadas);
    console.log(t.goodReceipt); console.log("GOOD_RECEIPT_JSON", JSON.stringify(conciliacionBuena));
    await agente.aprobar(conciliacionBuena);
    console.log(t.approval); console.log("OWNER_APPROVAL_JSON", JSON.stringify(conciliacionBuena));
    const dudoso = await lector.leer("fixtures/comprobantes/dudoso.json");
    const conciliacionDudosa = empatarComprobante("CON-DEMO-002", dudoso, libro, politicaDemo, agente.referenciasUsadas);
    console.log(t.suspiciousReceipt); console.log("SUSPICIOUS_RECEIPT_JSON", JSON.stringify(conciliacionDudosa));
  }
  console.log(t.debtorMessages);
  mensajes.forEach((mensaje, indice) => console.log(t.draftStatus(borradores[indice]), mensaje));
  console.log(t.ledgerAfter); libro.cuentas.forEach((cuenta) => console.log(t.summary(cuenta)));
  console.log("LEDGER_AFTER_JSON", JSON.stringify(libro, null, 2));
  if (grabar) console.log(t.recordingsSaved);
}
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(texto().demoError);
  console.error("ERROR_JSON", JSON.stringify({ message }));
  process.exitCode = 1;
});
