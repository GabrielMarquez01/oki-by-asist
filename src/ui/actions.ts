import { z } from "zod";
export const AccionSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("cobrar"), idioma: z.enum(["es", "en"]) }).strict(),
  z.object({ accion: z.literal("enviar"), cuentaId: z.string() }).strict(),
  z.object({ accion: z.literal("recibir"), muestra: z.enum(["bueno", "otra-cuenta"]) }).strict(),
  z.object({ accion: z.literal("aprobar"), id: z.string(), revisado: z.boolean().default(false), confirmado: z.boolean().default(false) }).strict(),
  z.object({ accion: z.literal("rechazar"), id: z.string() }).strict(),
  z.object({ accion: z.literal("reiniciar") }).strict(),
]);
