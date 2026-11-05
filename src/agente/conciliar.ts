import { z } from "zod";
import type { Libro } from "../libro/index.js";
import type { CobrosPayPal } from "../paypal/index.js";
import type { Conciliacion } from "../comprobantes/empatar.js";

function cuentaDe(libro: Libro, conciliacion: Conciliacion) {
  const cuenta = libro.cuentas.find((item) => item.id === conciliacion.cuentaId);
  if (!cuenta || !cuenta.paypalInvoiceId) throw new Error("La conciliación no tiene un cobro PayPal aprobable");
  return cuenta;
}

export class AgenteConciliador {
  readonly referenciasUsadas: string[] = [];
  constructor(private readonly libro: Libro, private readonly paypal: CobrosPayPal) {}
  async aprobar(conciliacion: Conciliacion): Promise<void> {
    if (conciliacion.estado === "sospechoso") throw new Error("Un comprobante sospechoso requiere aprobarRevisado del dueño");
    await this.registrar(conciliacion);
  }
  async aprobarRevisado(conciliacion: Conciliacion): Promise<void> {
    if (conciliacion.estado !== "sospechoso") throw new Error("aprobarRevisado solo aplica a comprobantes sospechosos");
    conciliacion.revisadoPorDueno = true;
    await this.registrar(conciliacion);
  }
  private async registrar(conciliacion: Conciliacion): Promise<void> {
    const cuenta = cuentaDe(this.libro, conciliacion);
    const invoiceId = cuenta.paypalInvoiceId;
    if (!invoiceId) throw new Error("La conciliación no tiene un cobro PayPal aprobable");
    const lectura = z.object({ monto: z.number().positive(), fecha: z.string().date(), referencia: z.string().min(1) }).parse(conciliacion.lectura);
    try {
      await this.paypal.registrarPagoExterno(invoiceId, { monto: lectura.monto, metodo: "BANK_TRANSFER", fecha: lectura.fecha });
      const cobro = await this.paypal.consultar(invoiceId);
      cuenta.saldo = Math.max(0, cuenta.saldo - lectura.monto);
      cuenta.estado = cobro.status === "PAID" || cuenta.saldo === 0 ? "pagado" : "parcial";
      conciliacion.estado = cuenta.estado;
      this.referenciasUsadas.push(lectura.referencia);
    } catch (error: unknown) {
      cuenta.estado = "error"; cuenta.motivoError = error instanceof Error ? error.message : "Error desconocido de PayPal"; conciliacion.estado = "error";
    }
  }
}
