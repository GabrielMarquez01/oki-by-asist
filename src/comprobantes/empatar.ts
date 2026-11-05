import { z } from "zod";
import type { Cuenta, Libro } from "../libro/index.js";
import type { Politica } from "../politica.js";
import type { LecturaComprobante } from "./lector.js";

const MotivoSchema = z.enum(["monto_distinto_o_mayor_al_saldo", "referencia_ya_usada", "fecha_fuera_de_ventana", "confianza_baja", "ningun_cobro_candidato", "mas_de_un_candidato"]);
export const ConciliacionSchema = z.object({
  id: z.string().min(1), lectura: z.custom<LecturaComprobante>(), estado: z.enum(["por_confirmar", "sospechoso", "parcial", "pagado", "error"]),
  cuentaId: z.string().optional(), motivo: MotivoSchema.optional(), revisadoPorDueno: z.boolean().default(false),
});
export type Conciliacion = z.infer<typeof ConciliacionSchema>;

function diasEntre(primera: string, segunda: string): number { return Math.abs((Date.parse(primera) - Date.parse(segunda)) / 86400000); }
function estaAbierta(cuenta: Cuenta): boolean { return ["pendiente", "vencido", "por_confirmar", "parcial"].includes(cuenta.estado) && cuenta.saldo > 0; }
function mencionaCobro(lectura: LecturaComprobante, cuenta: Cuenta): boolean { return lectura.referencia.toLowerCase().includes(cuenta.id.toLowerCase()); }

export function empatarComprobante(id: string, lectura: LecturaComprobante, libro: Libro, politica: Politica, referenciasUsadas: readonly string[] = []): Conciliacion {
  const base = { id: z.string().min(1).parse(id), lectura: z.custom<LecturaComprobante>().parse(lectura), revisadoPorDueno: false };
  const porReferencia = libro.cuentas.filter((cuenta) => estaAbierta(cuenta) && mencionaCobro(lectura, cuenta));
  const cuentaRevisable = porReferencia.length === 1 ? { cuentaId: porReferencia[0].id } : {};
  if (lectura.confianza < politica.confianzaMinima) return ConciliacionSchema.parse({ ...base, ...cuentaRevisable, estado: "sospechoso", motivo: "confianza_baja" });
  if (referenciasUsadas.includes(lectura.referencia)) return ConciliacionSchema.parse({ ...base, ...cuentaRevisable, estado: "sospechoso", motivo: "referencia_ya_usada" });
  if (porReferencia.length === 0) return ConciliacionSchema.parse({ ...base, estado: "sospechoso", motivo: "ningun_cobro_candidato" });
  const porFecha = porReferencia.filter((cuenta) => diasEntre(lectura.fecha, cuenta.vencimiento) <= politica.ventanaComprobanteDias);
  if (porFecha.length === 0) return ConciliacionSchema.parse({ ...base, estado: "sospechoso", motivo: "fecha_fuera_de_ventana" });
  const porMonto = porFecha.filter((cuenta) => lectura.monto <= cuenta.saldo);
  if (porMonto.length === 0) return ConciliacionSchema.parse({ ...base, estado: "sospechoso", motivo: "monto_distinto_o_mayor_al_saldo" });
  if (porMonto.length > 1) return ConciliacionSchema.parse({ ...base, estado: "sospechoso", motivo: "mas_de_un_candidato" });
  return ConciliacionSchema.parse({ ...base, estado: "por_confirmar", cuentaId: porMonto[0].id });
}
