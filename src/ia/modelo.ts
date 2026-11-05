/** The only Gemini model selection point in OKI. */
export const MODELO_GEMINI_PREDETERMINADO = "gemini-3.5-flash";

export function modeloGemini(env: NodeJS.ProcessEnv = process.env): string {
  const configurado = env.OKI_GEMINI_MODEL?.trim();
  return configurado || MODELO_GEMINI_PREDETERMINADO;
}
