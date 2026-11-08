import { z } from "zod";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import type { Cuenta, Libro } from "../libro/index.js";
import { evaluarPolitica, type Politica } from "../politica.js";
import type { CobrosPayPal } from "../paypal/index.js";
import { idiomaActual, texto, type Idioma } from "../i18n.js";
import { modeloGemini } from "../ia/modelo.js";

export interface Redactor { redactar(cuenta: Cuenta, urlPago: string, tono: Politica["tono"], idioma: Idioma, signal?: AbortSignal): Promise<string>; }
export class RedactorPlantilla implements Redactor {
  async redactar(cuenta: Cuenta, urlPago: string, _tono: Politica["tono"], idioma: Idioma): Promise<string> {
    return texto(idioma).message(cuenta.cliente.replace("DEMO ", ""), cuenta.monto, urlPago);
  }
}
export class RedactorGemini implements Redactor {
  constructor(private readonly modelo: string, private readonly generar: GeneradorBorrador) {}

  async redactar(cuenta: Cuenta, urlPago: string, tono: Politica["tono"], idioma: Idioma, abortSignal?: AbortSignal): Promise<string> {
    const prompt = texto(idioma).geminiPrompt(cuenta.cliente, cuenta.monto, tono, urlPago)
      + `\nInclude the exact amount "${cuenta.monto.toFixed(2)} MXN" and the exact payment link, separated by whitespace. Do not add other amounts or links.`;
    return this.generar({ modelo: this.modelo, prompt, abortSignal });
  }
}

export type EstadoBorrador =
  | { tipo: "pendiente" }
  | { tipo: "plantilla" }
  | { tipo: "ia_viva"; modelo: string }
  | { tipo: "ia_no_disponible"; motivo: string };

export type GeneradorBorrador = (input: { modelo: string; prompt: string; abortSignal?: AbortSignal }) => Promise<string>;
export const TOPE_IA_MS = 20_000;

// Strict format gate, not semantic money interpretation. After removing exact
// links and canonical amounts, reject every remaining digit, currency symbol,
// ISO currency code or supported currency name. Even dates fall back safely.
const monedas = new Set(Intl.supportedValuesOf("currency").map(codigo => codigo.toLowerCase()));
const nombresMoneda = /(?<![\p{L}\p{M}\p{N}])(?:pesos?|d[oó]lar(?:es)?|dollars?|euros?|libras?|pounds?|yen(?:es)?|yuan(?:es)?|francos?|francs?|reales?|reais|rupees?|rupias?)(?![\p{L}\p{M}\p{N}])/iu;
function dineroCorrecto(mensaje: string, cuenta: Cuenta, urlPago: string): boolean {
  const patronLiga = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"']+|(?<![\p{L}\p{N}_-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}]{2,}(?::\d+)?(?:[/?#][^\s<>"']*)?/giu;
  let ligas = 0;
  let ligaIncorrecta = false;
  const sinLigas = mensaje.replace(patronLiga, liga => {
    ligas++;
    // Sentence punctuation and Markdown wrappers are outside the destination.
    const sufijo = liga.startsWith(urlPago) ? liga.slice(urlPago.length) : "";
    if (liga !== urlPago && (!sufijo || !/^[.,;:!?\)\]\}]+$/.test(sufijo))) ligaIncorrecta = true;
    return " ";
  });
  if (!ligas || ligaIncorrecta) return false;

  if (/[+\-\p{Sm}\u2010-\u2015]\s*(?:\$\s*)?\d/u.test(sinLigas)) return false;
  const monto = cuenta.monto.toFixed(2).replace(".", "\\.");
  const canonico = new RegExp(`(?<![\\p{L}\\p{N}_.,+\\-\\p{Sm}\\u2010-\\u2015\\p{Sc}])\\$?${monto} MXN(?![\\p{L}\\p{N}_])`, "giu");
  let montos = 0;
  const resto = sinLigas.replace(canonico, () => { montos++; return " "; });
  const monedaRestante = (resto.match(/\p{L}+/gu) ?? []).some(palabra => monedas.has(palabra.toLowerCase()));
  return montos > 0 && !/[\p{N}\p{Sc}]/u.test(resto) && !monedaRestante && !nombresMoneda.test(resto);
}

export class RedactorConRespaldo implements Redactor {
  private ultimo: EstadoBorrador = { tipo: "pendiente" };

  constructor(private readonly principal: Redactor, private readonly respaldo = new RedactorPlantilla(),
    private readonly modelo = modeloGemini(), private readonly secreto = "") {}

  async redactar(cuenta: Cuenta, urlPago: string, tono: Politica["tono"], idioma: Idioma): Promise<string> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let motivo = "request failed";
    try {
      const limite = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          motivo = "timeout";
          reject(new Error("timeout"));
          controller.abort();
        }, TOPE_IA_MS);
      });
      const mensaje = await Promise.race([
        this.principal.redactar({ ...cuenta }, urlPago, tono, idioma, controller.signal), limite,
      ]);
      if (this.secreto && (mensaje.includes(this.secreto) || this.modelo.includes(this.secreto))) {
        motivo = "unsafe draft";
        throw new Error(motivo);
      }
      if (!dineroCorrecto(mensaje, cuenta, urlPago)) {
        motivo = "invalid payment details";
        throw new Error(motivo);
      }
      this.ultimo = { tipo: "ia_viva", modelo: this.modelo };
      return mensaje;
    } catch (error: unknown) {
      this.ultimo = { tipo: "ia_no_disponible", motivo: motivo === "request failed" ? motivoCortoGemini(error) : motivo };
      return this.respaldo.redactar(cuenta, urlPago, tono, idioma);
    } finally {
      clearTimeout(timer);
    }
  }

  estado(): EstadoBorrador {
    return { ...this.ultimo };
  }
}

export interface RedactorSeleccionado {
  redactor: Redactor;
  estado(): EstadoBorrador;
}

export function seleccionarRedactor(env: NodeJS.ProcessEnv = process.env, generar?: GeneradorBorrador): RedactorSeleccionado {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    return { redactor: new RedactorPlantilla(), estado: () => ({ tipo: "plantilla" }) };
  }
  const modelo = modeloGemini(env);
  const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
  const generador: GeneradorBorrador = generar ?? (async ({ modelo, prompt, abortSignal }) => {
    const result = await generateText({ model: google(modelo), prompt, abortSignal, maxRetries: 0 });
    return result.text;
  });
  const redactor = new RedactorConRespaldo(new RedactorGemini(modelo, generador), new RedactorPlantilla(), modelo, env.GOOGLE_GENERATIVE_AI_API_KEY);
  return { redactor, estado: () => redactor.estado() };
}

function motivoCortoGemini(error: unknown): string {
  if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599) {
    return `HTTP ${error.status}`;
  }
  if (typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" && Number.isInteger(error.statusCode) && error.statusCode >= 100 && error.statusCode <= 599) {
    return `HTTP ${error.statusCode}`;
  }
  return "request failed";
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
