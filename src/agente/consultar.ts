import type { Libro } from "../libro/index.js";
import type { CobrosPayPal } from "../paypal/index.js";

export async function consultarCobros(libro: Libro, paypal: CobrosPayPal): Promise<void> {
  for (const cuenta of libro.cuentas) {
    if (!cuenta.paypalInvoiceId) continue;
    const cobro = await paypal.consultar(cuenta.paypalInvoiceId);
    if (cobro.due_amount) cuenta.saldo = Number(cobro.due_amount.value);
    if (cobro.status === "PAID") cuenta.estado = "pagado";
    if (cobro.status === "PARTIALLY_PAID") cuenta.estado = "parcial";
  }
}
