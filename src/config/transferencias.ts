import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const CampoSchema = z.enum(["referencia", "claveRastreo", "bancoEmisor"]);
export const MetodoTransferenciaSchema = z.object({
  id: z.string().min(1), nombre: z.string().min(1), campos: z.array(CampoSchema).min(1),
}).superRefine((metodo, contexto) => {
  if (!metodo.campos.includes("referencia")) contexto.addIssue({ code: z.ZodIssueCode.custom, message: "Todo método requiere el campo referencia" });
});
export const TransferenciasSchema = z.object({ metodos: z.array(MetodoTransferenciaSchema).min(1) }).superRefine((configuracion, contexto) => {
  if (new Set(configuracion.metodos.map((metodo) => metodo.id)).size !== configuracion.metodos.length) contexto.addIssue({ code: z.ZodIssueCode.custom, message: "Los id de transferencia deben ser únicos" });
});
export type Transferencias = z.infer<typeof TransferenciasSchema>;

export function cargarTransferencias(ruta = resolve(process.cwd(), "config/transferencias.json")): Transferencias {
  let contenido: string;
  try { contenido = readFileSync(ruta, "utf8"); } catch (error: unknown) { throw new Error(`No se pudo leer configuración de transferencias: ${error instanceof Error ? error.message : "error desconocido"}`); }
  try { return TransferenciasSchema.parse(JSON.parse(contenido)); } catch (error: unknown) { throw new Error(`Configuración de transferencias inválida: ${error instanceof Error ? error.message : "error desconocido"}`); }
}
