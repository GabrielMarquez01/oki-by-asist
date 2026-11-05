#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--sandbox" ]]; then
  export PAYPAL_ENVIRONMENT="${PAYPAL_ENVIRONMENT:-SANDBOX}"
  set +e
  idioma="${OKI_LANG:-en}"
  output="$(OKI_LANG="$idioma" npm run demo:sandbox 2>&1)"
  demo_rc=$?
  set -e
  printf '%s\n' "$output"
  if [[ "$demo_rc" -ne 0 ]]; then
    exit "$demo_rc"
  fi
  DEMO_OUTPUT="$output" node --input-type=module <<'NODE'
const match = (process.env.DEMO_OUTPUT ?? "").match(/LEDGER_AFTER_JSON ([\s\S]+)$/);
if (!match) throw new Error("No se imprimió el libro final sandbox");
const cuenta = JSON.parse(match[1]).cuentas[0]; const estado = cuenta.estado;
if (!["parcial", "pagado"].includes(estado)) throw new Error(`Pago externo no reflejado: ${estado}`);
if (estado === "parcial" && cuenta.saldo !== 720) throw new Error(`Saldo parcial incorrecto: ${cuenta.saldo}`);
NODE
  echo "probar-demo sandbox: OK"
  exit 0
fi
npm test
npx tsc --noEmit
for idioma in en es; do
output="$(OKI_LANG="$idioma" npm run demo)"
printf '%s\n' "$output"
LANGUAGE="$idioma" DEMO_OUTPUT="$output" node --input-type=module <<'NODE'
const output = process.env.DEMO_OUTPUT ?? "";
const language = process.env.LANGUAGE;
const hasApiKey = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
if (language === "en") {
  if (!output.includes("CONFIGURED DEMO TRANSFER METHODS") || !output.includes("ACCOUNT SUMMARY AFTER") || !output.includes("DEMO DEBTOR MESSAGES") || !output.includes(hasApiKey ? "Alma" : "Hello Alma")) throw new Error("La demo inglesa no imprimió sus rótulos en inglés");
  if (/MÉTODOS DE TRANSFERENCIA|RESUMEN DEL LIBRO|COMPROBANTE DEMO|MENSAJES DEMO AL DEUDOR|Hola Alma/.test(output)) throw new Error("La demo inglesa imprimió un rótulo para personas en español");
  if (!hasApiKey && !output.includes("TEMPLATE DRAFT · no API key (fixed text)")) throw new Error("La demo inglesa sin llave no informó TEMPLATE DRAFT");
  if (hasApiKey && !output.includes("AI DRAFT · Gemini ") && !output.includes("AI UNAVAILABLE · ")) throw new Error("La demo inglesa con llave no informó IA");
  if (hasApiKey && !output.includes("AI DRAFT · Gemini ")) throw new Error("FALLA: la demo inglesa con llave no obtuvo AI DRAFT live");
}
if (language === "es") {
  if (!output.includes("MÉTODOS DE TRANSFERENCIA DEMO CONFIGURADOS") || !output.includes("RESUMEN DEL LIBRO DESPUÉS") || !output.includes("MENSAJES DEMO AL DEUDOR") || !output.includes(hasApiKey ? "Alma" : "Hola Alma")) throw new Error("La demo española no imprimió sus rótulos en español");
  if (!hasApiKey && !output.includes("BORRADOR DE PLANTILLA · sin llave API (texto fijo)")) throw new Error("La demo española sin llave no informó su plantilla");
  if (hasApiKey && !output.includes("BORRADOR IA · Gemini ") && !output.includes("IA NO DISPONIBLE · ")) throw new Error("La demo española con llave no informó IA");
  if (hasApiKey && !output.includes("BORRADOR IA · Gemini ")) throw new Error("FALLA: la demo española con llave no obtuvo borrador IA en vivo");
}
const match = output.match(/LEDGER_AFTER_JSON ([\s\S]+)$/);
if (!match) throw new Error("No se imprimió el libro final");
const libro = JSON.parse(match[1]);
const estados = libro.cuentas.map((cuenta) => cuenta.estado);
if (!["parcial", "pagado"].includes(estados[0]) || estados[1] !== "por_confirmar") throw new Error("El comprobante bueno no actualizó el cobro o faltó un cobro enviado");
if (estados[4] !== "parcial" || estados[5] !== "pagado") throw new Error("Estados de demo inesperados");
const bueno = output.match(/GOOD_RECEIPT_JSON (.+)/);
const dudoso = output.match(/SUSPICIOUS_RECEIPT_JSON (.+)/);
if (!bueno || JSON.parse(bueno[1]).estado !== "por_confirmar") throw new Error("El comprobante bueno no quedó por_confirmar antes de aprobarse");
const comprobanteDudoso = dudoso ? JSON.parse(dudoso[1]) : undefined;
if (!comprobanteDudoso || comprobanteDudoso.estado !== "sospechoso" || comprobanteDudoso.motivo !== "referencia_ya_usada") throw new Error("El comprobante dudoso no quedó sospechoso sin registrar");
NODE
done
echo "probar-demo: OK"
