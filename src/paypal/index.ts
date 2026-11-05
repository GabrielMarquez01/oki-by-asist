import { ALL_TOOLS_ENABLED, PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { z } from "zod";

const Dinero = z.object({ currency_code: z.literal("MXN"), value: z.string().regex(/^\d+(\.\d{2})$/) });
export const CobroSchema = z.object({ id: z.string(), status: z.string(), amount: Dinero, due_amount: Dinero.optional(), allow_partial_payment: z.boolean(), minimum_partial_payment_amount: z.string().optional() });
export const QrSchema = z.object({ href: z.string().url() });
export const EnvioSchema = z.object({ href: z.string().url().optional() });
export type Cobro = z.infer<typeof CobroSchema>;
export type CrearCobro = { referencia: string; monto: number; permitirParcial: boolean; minimoParcialPct: number };
export type PagoExterno = { monto: number; metodo: "BANK_TRANSFER"; fecha: string };

export interface CobrosPayPal {
  crear(input: CrearCobro): Promise<Cobro>;
  enviar(invoiceId: string): Promise<z.infer<typeof EnvioSchema>>;
  qr(invoiceId: string): Promise<z.infer<typeof QrSchema>>;
  consultar(invoiceId: string): Promise<Cobro>;
  registrarPagoExterno(invoiceId: string, pago: PagoExterno): Promise<void>;
}

function formato(monto: number): string { return monto.toFixed(2); }
function validarId(invoiceId: string): string { return z.string().min(1).parse(invoiceId); }

export class PayPalSimulado implements CobrosPayPal {
  private readonly cobros = new Map<string, Cobro>();
  private sequence = 0;
  constructor(private readonly fallar = false) {
    this.cobros.set("INV-DEMO-PARCIAL", CobroSchema.parse({ id: "INV-DEMO-PARCIAL", status: "PARTIALLY_PAID", amount: { currency_code: "MXN", value: "1500.00" }, allow_partial_payment: true }));
  }
  async crear(input: CrearCobro): Promise<Cobro> {
    if (this.fallar) throw new Error("PayPal simulado: create_invoice falló");
    const data = z.object({ referencia: z.string().min(1), monto: z.number().positive(), permitirParcial: z.boolean(), minimoParcialPct: z.number().min(1).max(100) }).parse(input);
    const id = `INV-DEMO-${++this.sequence}`;
    const cobro = CobroSchema.parse({ id, status: "DRAFT", amount: { currency_code: "MXN", value: formato(data.monto) }, allow_partial_payment: data.permitirParcial, minimum_partial_payment_amount: data.permitirParcial ? formato(data.monto * data.minimoParcialPct / 100) : undefined });
    this.cobros.set(id, cobro); return cobro;
  }
  async enviar(invoiceId: string): Promise<z.infer<typeof EnvioSchema>> { if (this.fallar) throw new Error("PayPal simulado: send_invoice falló"); const id = validarId(invoiceId); return { href: `https://www.sandbox.paypal.com/invoice/payerView/details/${id}` }; }
  async qr(invoiceId: string): Promise<z.infer<typeof QrSchema>> { validarId(invoiceId); return QrSchema.parse({ href: `https://www.sandbox.paypal.com/invoice/payerView/details/${invoiceId}` }); }
  async consultar(invoiceId: string): Promise<Cobro> { const found = this.cobros.get(validarId(invoiceId)); if (!found) throw new Error("Cobro DEMO no encontrado"); return found; }
  async registrarPagoExterno(invoiceId: string, pago: PagoExterno): Promise<void> { const prior = await this.consultar(invoiceId); const paid = z.number().positive().parse(pago.monto); const total = Number(prior.amount.value); this.cobros.set(invoiceId, CobroSchema.parse({ ...prior, status: paid >= total ? "PAID" : "PARTIALLY_PAID" })); }
}

type ToolkitTool = { execute: (input: Record<string, unknown>) => Promise<unknown> };
function resumenRespuesta(value: string): string { return value.slice(0, 200); }
function objeto(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "string") {
    const texto = value;
    try { value = JSON.parse(texto); }
    catch { throw new Error(`Respuesta de PayPal no es JSON válido: ${resumenRespuesta(texto)}`); }
  }
  const respuesta = z.record(z.unknown()).parse(value);
  const nombre = typeof respuesta.name === "string" ? respuesta.name : undefined;
  const mensaje = typeof respuesta.message === "string" ? respuesta.message : undefined;
  if (nombre && mensaje) throw new Error(`PayPal ${nombre}: ${mensaje}`);
  if (typeof respuesta.error === "string") throw new Error(`PayPal: ${respuesta.error}`);
  if (typeof respuesta.status === "number" && respuesta.status >= 400) throw new Error(`PayPal devolvió HTTP ${respuesta.status}`);
  return respuesta;
}
function idDesdeHref(href: unknown): string | undefined {
  if (typeof href !== "string") return undefined;
  const ultimoSegmento = href.split("/").filter(Boolean).at(-1);
  return ultimoSegmento && /^INV2-[A-Z0-9-]+$/.test(ultimoSegmento) ? ultimoSegmento : undefined;
}

function pngDesdeMultipart(cuerpo: string): string {
  const inicio = /^--([^\r\n]+)\r?\n/.exec(cuerpo);
  if (!inicio) throw new Error("Respuesta QR de PayPal no contiene un multipart válido");
  const separador = `--${inicio[1]}`;
  const parteImagen = cuerpo.split(separador).find((parte) => /content-disposition:[^\r\n]*\bname="image"/i.test(parte));
  if (!parteImagen) throw new Error("Respuesta QR de PayPal no contiene la parte image");
  const cabeceraYContenido = /\r?\n\r?\n([\s\S]*?)\r?\n?$/.exec(parteImagen);
  if (!cabeceraYContenido) throw new Error("Respuesta QR de PayPal no contiene datos de imagen");
  const base64 = cabeceraYContenido[1].replace(/\s/g, "");
  if (
    !base64.startsWith("iVBORw0KGgo")
    || base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) throw new Error("Respuesta QR de PayPal contiene una imagen PNG base64 inválida");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Respuesta QR de PayPal no contiene la firma PNG");
  }
  return `data:image/png;base64,${base64}`;
}

function respuestaQr(value: unknown): z.infer<typeof QrSchema> {
  if (typeof value === "string") {
    try { return respuestaQr(JSON.parse(value)); }
    catch (error) {
      if (value.startsWith("--")) return QrSchema.parse({ href: pngDesdeMultipart(value) });
      throw error;
    }
  }
  const respuesta = z.record(z.unknown()).parse(value);
  return QrSchema.parse({ href: respuesta.href ?? respuesta.image_url });
}
export class PayPalReal implements CobrosPayPal {
  private readonly tools: Record<string, ToolkitTool>;
  constructor(clientId: string, clientSecret: string, private readonly alResponder?: (nombre: string, respuesta: unknown) => void) {
    if (process.env.PAYPAL_ENVIRONMENT !== "SANDBOX") throw new Error("PAYPAL_ENVIRONMENT debe ser SANDBOX para usar PayPal real");
    const toolkit = new PayPalAgentToolkit({ clientId: z.string().min(1).parse(clientId), clientSecret: z.string().min(1).parse(clientSecret), configuration: { actions: ALL_TOOLS_ENABLED, context: { sandbox: true } } });
    this.tools = toolkit.getTools() as unknown as Record<string, ToolkitTool>;
  }
  private async ejecutar(nombre: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return objeto(await this.ejecutarCrudo(nombre, input));
  }
  private async ejecutarCrudo(nombre: string, input: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools[nombre]; if (!tool) throw new Error(`Herramienta PayPal ausente: ${nombre}`);
    const respuesta = await tool.execute(input);
    this.alResponder?.(nombre, respuesta);
    return respuesta;
  }
  async crear(input: CrearCobro): Promise<Cobro> {
    const value = formato(z.number().positive().parse(input.monto));
    const raw = await this.ejecutar("create_invoice", { currency_code: "MXN", reference: input.referencia, primary_recipients: [{}], items: [{ name: "Cobro DEMO", quantity: "1", unit_amount: { currency_code: "MXN", value } }], allow_partial_payment: input.permitirParcial, minimum_partial_payment_amount: input.permitirParcial ? formato(input.monto * input.minimoParcialPct / 100) : undefined });
    const id = typeof raw.id === "string" ? raw.id : idDesdeHref(raw.href);
    if (!id) throw new Error("PayPal no devolvió id ni enlace de la factura creada");
    const factura = await this.ejecutar("get_invoice", { invoice_id: id });
    return CobroSchema.parse({
      id: factura.id ?? id,
      status: factura.status,
      amount: factura.amount,
      allow_partial_payment: factura.allow_partial_payment ?? input.permitirParcial,
      minimum_partial_payment_amount: factura.minimum_partial_payment_amount as string | undefined,
    });
  }
  // send_to_recipient:false — la cuenta del deudor no trae correo; PayPal da 422 «Missing recipient email» si lo manda por correo. El enlace de pago lo entrega OKI por su canal (medido en sandbox 2026-11-04).
  async enviar(invoiceId: string): Promise<z.infer<typeof EnvioSchema>> {
    const respuesta = await this.ejecutar("send_invoice", { invoice_id: validarId(invoiceId), send_to_recipient: false });
    return EnvioSchema.parse({ href: respuesta.rel === "payer-view" ? respuesta.href : undefined });
  }
  async qr(invoiceId: string): Promise<z.infer<typeof QrSchema>> { return respuestaQr(await this.ejecutarCrudo("generate_invoice_qr_code", { invoice_id: validarId(invoiceId) })); }
  async consultar(invoiceId: string): Promise<Cobro> {
    const raw = await this.ejecutar("get_invoice", { invoice_id: validarId(invoiceId) });
    const amount = Dinero.parse(raw.amount);
    const dueAmount = raw.due_amount === undefined ? undefined : Dinero.parse(raw.due_amount);
    const paidAmount = raw.payments !== undefined && typeof raw.payments === "object" && raw.payments !== null
      ? Dinero.optional().parse((raw.payments as Record<string, unknown>).paid_amount) : undefined;
    const saldo = dueAmount ?? (paidAmount ? { currency_code: amount.currency_code, value: formato(Math.max(0, Number(amount.value) - Number(paidAmount.value))) } : undefined);
    return CobroSchema.parse({ id: raw.id, status: raw.status, amount, due_amount: saldo, allow_partial_payment: raw.allow_partial_payment ?? false, minimum_partial_payment_amount: raw.minimum_partial_payment_amount as string | undefined });
  }
  async registrarPagoExterno(invoiceId: string, pago: PagoExterno): Promise<void> {
    const input = z.object({ monto: z.number().positive(), metodo: z.literal("BANK_TRANSFER"), fecha: z.string().date() }).parse(pago);
    await this.ejecutar("record_payment_for_invoice", { invoice_id: validarId(invoiceId), method: input.metodo, payment_date: input.fecha, amount: { currency_code: "MXN", value: formato(input.monto) } });
  }
}
