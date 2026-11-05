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
if (language === "en") {
  if (!output.includes("CONFIGURED DEMO TRANSFER METHODS") || !output.includes("ACCOUNT SUMMARY AFTER") || !output.includes("DEMO DEBTOR MESSAGES") || !output.includes("Hello Alma")) throw new Error("La demo inglesa no imprimió sus rótulos en inglés");
  if (/MÉTODOS DE TRANSFERENCIA|RESUMEN DEL LIBRO|COMPROBANTE DEMO|MENSAJES DEMO AL DEUDOR|Hola Alma/.test(output)) throw new Error("La demo inglesa imprimió un rótulo para personas en español");
}
if (language === "es") {
  if (!output.includes("MÉTODOS DE TRANSFERENCIA DEMO CONFIGURADOS") || !output.includes("RESUMEN DEL LIBRO DESPUÉS") || !output.includes("MENSAJES DEMO AL DEUDOR") || !output.includes("Hola Alma")) throw new Error("La demo española no imprimió sus rótulos en español");
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
