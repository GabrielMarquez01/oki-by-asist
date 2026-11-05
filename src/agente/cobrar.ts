import { z } from "zod";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import type { Cuenta, Libro } from "../libro/index.js";
import { evaluarPolitica, type Politica } from "../politica.js";
import type { CobrosPayPal } from "../paypal/index.js";
import { idiomaActual, texto, type Idioma } from "../i18n.js";

export interface Redactor { redactar(cuenta: Cuenta, urlPago: string, tono: Politica["tono"], idioma: Idioma): Promise<string>; }
export class RedactorPlantilla implements Redactor {
  async redactar(cuenta: Cuenta, urlPago: string, _tono: Politica["tono"], idioma: Idioma): Promise<string> {
    return texto(idioma).message(cuenta.cliente.replace("DEMO ", ""), cuenta.monto, urlPago);
  }
}
export class RedactorGemini implements Redactor {
  async redactar(cuenta: Cuenta, urlPago: string, tono: Politica["tono"], idioma: Idioma): Promise<string> {
    const prompt = texto(idioma).geminiPrompt(cuenta.cliente, cuenta.monto, tono, urlPago);
    const result = await generateText({ model: google("gemini-2.5-flash"), prompt });
    return result.text;
  }
}
export async function cobrarVencidas(libro: Libro, paypal: CobrosPayPal, politica: Politica, redactor: Redactor, idioma = idiomaActual()): Promise<string[]> {
  const mensajes: string[] = [];
  for (const cuenta of libro.cuentas.filter((item) => item.estado === "vencido" && item.via === "paypal")) {
    if (evaluarPolitica(cuenta.monto, politica) === "requiere_aprobacion") { continue; }
    try {
      const cobro = await paypal.crear(z.object({ referencia: z.string(), monto: z.number(), permitirParcial: z.boolean(), minimoParcialPct: z.number() }).parse({ referencia: cuenta.id, monto: cuenta.monto, permitirParcial: politica.permitirParcial, minimoParcialPct: politica.minimoParcialPct }));
      const envio = await paypal.enviar(cobro.id); const qr = await paypal.qr(cobro.id);
      cuenta.paypalInvoiceId = cobro.id; cuenta.estado = "por_confirmar";
      mensajes.push(await redactor.redactar(cuenta, envio.href ?? qr.href, politica.tono, idioma));
    } catch (error: unknown) { cuenta.estado = "error"; cuenta.motivoError = error instanceof Error ? error.message : "Error desconocido de PayPal"; }
  }
  return mensajes;
}
