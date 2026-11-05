import { z } from "zod";

export const PoliticaSchema = z.object({
  permitirParcial: z.boolean(),
  minimoParcialPct: z.number().min(1).max(100),
  topeSinAprobacion: z.number().positive(),
  tono: z.enum(["cercano", "formal"]),
  confianzaMinima: z.number().min(0).max(1),
  ventanaComprobanteDias: z.number().int().nonnegative(),
  cuentasCobro: z.array(z.string().regex(/^(?:\d{4}|\d{18})$/)).default([]),
});

export type Politica = z.infer<typeof PoliticaSchema>;

export const politicaDemo: Politica = PoliticaSchema.parse({
  permitirParcial: true,
  minimoParcialPct: 30,
  topeSinAprobacion: 5000,
  tono: "cercano",
  confianzaMinima: 0.8,
  ventanaComprobanteDias: 7,
  cuentasCobro: ["000000000000001200"], // Cuenta sintética DEMO, no recibe pagos.
});

export function evaluarPolitica(monto: number, politica: Politica): "autorizado" | "requiere_aprobacion" {
  return monto > politica.topeSinAprobacion ? "requiere_aprobacion" : "autorizado";
}
