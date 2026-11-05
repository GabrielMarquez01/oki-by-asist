import type { Cuenta } from "./libro/index.js";

export type Idioma = "en" | "es";

export function idiomaActual(): Idioma {
  return process.env.OKI_LANG === "es" ? "es" : "en";
}

const textos = {
  en: {
    transferMethods: "CONFIGURED DEMO TRANSFER METHODS",
    ledgerBefore: "ACCOUNT SUMMARY BEFORE",
    ledgerAfter: "ACCOUNT SUMMARY AFTER",
    goodReceipt: "DEMO GOOD RECEIPT",
    approval: "DEMO OWNER APPROVAL",
    suspiciousReceipt: "DEMO SUSPICIOUS RECEIPT",
    debtorMessages: "DEMO DEBTOR MESSAGES",
    sandboxReason: "Sandbox DEMO invoice reason",
    sandboxMissing: "The sandbox DEMO invoice was not created",
    recordingsSaved: "Sanitized sandbox responses saved in fixtures/.",
    demoError: "DEMO ERROR",
    status: { pendiente: "pending", vencido: "overdue", por_confirmar: "awaiting confirmation", parcial: "partially paid", pagado: "paid", error: "error" },
    summary: (cuenta: Cuenta) => `ID: ${cuenta.id} | Customer: ${cuenta.cliente} | Status: ${textos.en.status[cuenta.estado]} | Amount: $${cuenta.monto.toFixed(2)} ${cuenta.moneda} | Balance: $${cuenta.saldo.toFixed(2)} ${cuenta.moneda}`,
    message: (cliente: string, monto: number, urlPago: string) => `Hello ${cliente}, this is a DEMO message. Your $${monto.toFixed(2)} MXN payment is ready: ${urlPago}`,
    geminiPrompt: (cliente: string, monto: number, tono: string, urlPago: string) => `Write a brief message in English, ${tono} tone, marked DEMO. Customer: ${cliente}; amount: ${monto} MXN; payment link: ${urlPago}.`,
  },
  es: {
    transferMethods: "MÉTODOS DE TRANSFERENCIA DEMO CONFIGURADOS",
    ledgerBefore: "RESUMEN DEL LIBRO ANTES",
    ledgerAfter: "RESUMEN DEL LIBRO DESPUÉS",
    goodReceipt: "COMPROBANTE DEMO CORRECTO",
    approval: "APROBACIÓN DEL DUEÑO DEMO",
    suspiciousReceipt: "COMPROBANTE DEMO SOSPECHOSO",
    debtorMessages: "MENSAJES DEMO AL DEUDOR",
    sandboxReason: "Motivo del cobro DEMO sandbox",
    sandboxMissing: "No se creó el cobro DEMO sandbox",
    recordingsSaved: "Respuestas sandbox sanitizadas guardadas en fixtures/.",
    demoError: "ERROR DEMO",
    status: { pendiente: "pendiente", vencido: "vencido", por_confirmar: "por confirmar", parcial: "parcial", pagado: "pagado", error: "error" },
    summary: (cuenta: Cuenta) => `ID: ${cuenta.id} | Cliente: ${cuenta.cliente} | Estado: ${textos.es.status[cuenta.estado]} | Monto: $${cuenta.monto.toFixed(2)} ${cuenta.moneda} | Saldo: $${cuenta.saldo.toFixed(2)} ${cuenta.moneda}`,
    message: (cliente: string, monto: number, urlPago: string) => `Hola ${cliente}, este es un mensaje DEMO. Tu cobro por $${monto.toFixed(2)} MXN está listo: ${urlPago}`,
    geminiPrompt: (cliente: string, monto: number, tono: string, urlPago: string) => `Redacta un mensaje breve en español, tono ${tono}, marcado DEMO. Cliente: ${cliente}; monto: ${monto} MXN; enlace de pago: ${urlPago}.`,
  },
} as const;

export function texto(idioma = idiomaActual()) { return textos[idioma]; }
