import type { Libro } from "../libro/index.js";
import type { Detalle } from "./state.js";
import { PayPalReal, PayPalSimulado, type CobrosPayPal } from "../paypal/index.js";
import { ErrorUI, type Modo } from "./state.js";
export function crearProveedor(env: NodeJS.ProcessEnv = process.env): { modo: Modo; paypal: CobrosPayPal } {
  const id = env.PAYPAL_CLIENT_ID; const secret = env.PAYPAL_CLIENT_SECRET;
  if (!!id !== !!secret) throw new ErrorUI("config", 500);
  if (!id || !secret) return { modo: "simulado", paypal: new PayPalSimulado() };
  if (env.PAYPAL_ENVIRONMENT && env.PAYPAL_ENVIRONMENT !== "SANDBOX") throw new ErrorUI("config", 500);
  // The existing adapter also checks this environment value. No live environment is selected.
  process.env.PAYPAL_ENVIRONMENT = "SANDBOX";
  return { modo: "sandbox", paypal: new PayPalReal(id, secret) };
}

export function instrumentar(proveedor: CobrosPayPal, libro: Libro, detalles: Record<string, Detalle>, evento: (id: string, paso: string, resultado?: "ok" | "error") => void): CobrosPayPal {
    const ids = new Map<string, string>();
    const registrar = async <T>(id: string, paso: string, fn: () => Promise<T>): Promise<T> => {
      const cuentaId = ids.get(id) ?? libro.cuentas.find(c => c.paypalInvoiceId === id)?.id ?? id;
      try { const resultado = await fn(); evento(cuentaId, paso); return resultado; }
      catch { evento(cuentaId, paso, "error"); throw new ErrorUI("paypal", 502); }
    };
    return {
      crear: async input => registrar(input.referencia, "create_invoice", async () => {
        const cobro = await proveedor.crear(input); ids.set(cobro.id, input.referencia); return cobro;
      }),
      enviar: async id => registrar(id, "send_invoice", async () => {
        const envio = await proveedor.enviar(id); const cuenta = ids.get(id)!;
        detalles[cuenta] = { ...detalles[cuenta], url: envio.href }; return envio;
      }),
      qr: async id => registrar(id, "generate_invoice_qr_code", async () => {
        const qr = await proveedor.qr(id); const cuenta = ids.get(id)!;
        detalles[cuenta] = { ...detalles[cuenta], qr: qr.href }; return qr;
      }),
      consultar: id => registrar(id, "get_invoice", () => proveedor.consultar(id)),
      registrarPagoExterno: (id, pago) => registrar(id, "record_payment_for_invoice", () => proveedor.registrarPagoExterno(id, pago)),
    };
  }
