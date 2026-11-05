import { z } from "zod";

export const EstadoSchema = z.enum(["pendiente", "vencido", "por_confirmar", "parcial", "pagado", "error"]);
export const CuentaSchema = z.object({
  id: z.string().startsWith("DEMO-"),
  cliente: z.string().startsWith("DEMO "),
  monto: z.number().positive(),
  saldo: z.number().nonnegative(),
  moneda: z.literal("MXN"),
  vencimiento: z.string().date(),
  estado: EstadoSchema,
  via: z.enum(["paypal", "transferencia", "efectivo"]),
  paypalInvoiceId: z.string().optional(),
  motivoError: z.string().optional(),
});
export const LibroSchema = z.object({ cuentas: z.array(CuentaSchema).length(6) });
export type Cuenta = z.infer<typeof CuentaSchema>;
export type Libro = z.infer<typeof LibroSchema>;

export function libroDemo(hoy = new Date()): Libro {
  const iso = (days: number) => new Date(hoy.getTime() + days * 86400000).toISOString().slice(0, 10);
  return LibroSchema.parse({ cuentas: [
    { id: "DEMO-001", cliente: "DEMO Alma", monto: 1200, saldo: 1200, moneda: "MXN", vencimiento: iso(-3), estado: "vencido", via: "paypal" },
    { id: "DEMO-002", cliente: "DEMO Bruno", monto: 650, saldo: 650, moneda: "MXN", vencimiento: iso(-1), estado: "vencido", via: "paypal" },
    { id: "DEMO-003", cliente: "DEMO Cora", monto: 900, saldo: 900, moneda: "MXN", vencimiento: iso(2), estado: "pendiente", via: "transferencia" },
    { id: "DEMO-004", cliente: "DEMO Dario", monto: 300, saldo: 300, moneda: "MXN", vencimiento: iso(-5), estado: "por_confirmar", via: "transferencia" },
    { id: "DEMO-005", cliente: "DEMO Elsa", monto: 1500, saldo: 900, moneda: "MXN", vencimiento: iso(-7), estado: "parcial", via: "paypal", paypalInvoiceId: "INV-DEMO-PARCIAL" },
    { id: "DEMO-006", cliente: "DEMO Fabio", monto: 450, saldo: 0, moneda: "MXN", vencimiento: iso(-2), estado: "pagado", via: "efectivo" },
  ] });
}
