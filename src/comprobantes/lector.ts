import { readFileSync } from "node:fs";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

export const LecturaComprobanteSchema = z.object({
  monto: z.number().positive(),
  moneda: z.literal("MXN"),
  fecha: z.string().date(),
  metodo: z.string().min(1),
  referencia: z.string().min(1),
  banco: z.string().min(1).optional(),
  confianza: z.number().min(0).max(1),
  demo: z.boolean(),
});
export type LecturaComprobante = z.infer<typeof LecturaComprobanteSchema>;

export interface LectorComprobante { leer(origen: string): Promise<LecturaComprobante>; }

export class LectorComprobanteSimulado implements LectorComprobante {
  async leer(ruta: string): Promise<LecturaComprobante> {
    try { return LecturaComprobanteSchema.parse(JSON.parse(readFileSync(ruta, "utf8"))); }
    catch (error: unknown) { throw new Error(`Comprobante DEMO inválido: ${error instanceof Error ? error.message : "error desconocido"}`); }
  }
}

const LecturaVisionSchema = LecturaComprobanteSchema.omit({ demo: true });
export class LectorComprobanteReal implements LectorComprobante {
  async leer(imagen: string): Promise<LecturaComprobante> {
    const modelo = process.env.OKI_MODELO_VISION;
    if (!modelo) throw new Error("OKI_MODELO_VISION es obligatoria para leer comprobantes reales");
    const resultado = await generateObject({
      model: google(modelo), schema: LecturaVisionSchema,
      messages: [{ role: "user", content: [{ type: "text", text: "Extrae el comprobante de transferencia. No inventes datos." }, { type: "image", image: new URL(imagen) }] }],
    });
    return LecturaComprobanteSchema.parse({ ...resultado.object, demo: false });
  }
}
