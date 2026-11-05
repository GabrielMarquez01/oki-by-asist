import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PayPalReal } from "../src/paypal/index.js";

type Herramienta = { execute: (input: Record<string, unknown>) => Promise<unknown> };
function paypalCon(tools: Record<string, Herramienta>): PayPalReal {
  const previo = process.env.PAYPAL_ENVIRONMENT;
  process.env.PAYPAL_ENVIRONMENT = "SANDBOX";
  const paypal = new PayPalReal("cliente-sintetico", "valor-sintetico-no-credencial");
  process.env.PAYPAL_ENVIRONMENT = previo;
  (paypal as unknown as { tools: Record<string, Herramienta> }).tools = tools;
  return paypal;
}

describe("PayPalReal: respuestas del Agent Toolkit", () => {
  it("resuelve el HATEOAS string de create_invoice y consulta la factura", async () => {
    const fixture = JSON.parse(readFileSync(new URL("../fixtures/create-invoice-hateoas.json", import.meta.url), "utf8")) as { respuesta: string };
    const llamadas: string[] = [];
    const paypal = paypalCon({
      create_invoice: { execute: async () => { llamadas.push("create_invoice"); return fixture.respuesta; } },
      get_invoice: { execute: async (input) => {
        llamadas.push(`get_invoice:${input.invoice_id}`);
        return JSON.stringify({ id: input.invoice_id, status: "DRAFT", amount: { currency_code: "MXN", value: "1200.00" }, allow_partial_payment: true, minimum_partial_payment_amount: "360.00" });
      } },
    });

    await expect(paypal.crear({ referencia: "CTA-1", monto: 1200, permitirParcial: true, minimoParcialPct: 30 })).resolves.toMatchObject({ id: "INV2-TEST-ABCD-1234", status: "DRAFT", amount: { currency_code: "MXN", value: "1200.00" } });
    expect(llamadas).toEqual(["create_invoice", "get_invoice:INV2-TEST-ABCD-1234"]);
  });

  it("rechaza un string que no es JSON sin exponer más de 200 caracteres", async () => {
    const texto = "x".repeat(250);
    const paypal = paypalCon({ create_invoice: { execute: async () => texto } });
    await expect(paypal.crear({ referencia: "CTA-1", monto: 1200, permitirParcial: false, minimoParcialPct: 30 })).rejects.toThrow(`Respuesta de PayPal no es JSON válido: ${"x".repeat(200)}`);
  });

  it("acepta JSON serializado y cuerpos vacíos en las demás operaciones", async () => {
    const paypal = paypalCon({
      send_invoice: { execute: async () => "" },
      generate_invoice_qr_code: { execute: async () => JSON.stringify({ href: "https://www.sandbox.paypal.com/invoice/payerView/details/INV2-TEST-ABCD-1234" }) },
      get_invoice: { execute: async () => JSON.stringify({ id: "INV2-TEST-ABCD-1234", status: "SENT", amount: { currency_code: "MXN", value: "1200.00" }, allow_partial_payment: false }) },
      record_payment_for_invoice: { execute: async () => undefined },
    });

    await expect(paypal.enviar("INV2-TEST-ABCD-1234")).resolves.toEqual({ href: undefined });
    await expect(paypal.qr("INV2-TEST-ABCD-1234")).resolves.toEqual({ href: "https://www.sandbox.paypal.com/invoice/payerView/details/INV2-TEST-ABCD-1234" });
    await expect(paypal.consultar("INV2-TEST-ABCD-1234")).resolves.toMatchObject({ id: "INV2-TEST-ABCD-1234", status: "SENT" });
    await expect(paypal.registrarPagoExterno("INV2-TEST-ABCD-1234", { monto: 1200, metodo: "BANK_TRANSFER", fecha: "2026-11-04" })).resolves.toBeUndefined();
  });

  it("lee saldo pendiente de la respuesta parcial real grabada", async () => {
    const fixture = JSON.parse(readFileSync(new URL("../fixtures/paypal-get-invoice-partial-real.json", import.meta.url), "utf8")) as { respuesta: string };
    const paypal = paypalCon({ get_invoice: { execute: async () => fixture.respuesta } });
    await expect(paypal.consultar("INV2-27EX-CPU9-N7KF-F2VA")).resolves.toMatchObject({
      status: "PARTIALLY_PAID", amount: { value: "1200.00" }, due_amount: { value: "720.00" },
    });
  });

  it("lee payer-view de la respuesta real de send_invoice", async () => {
    const fixture = JSON.parse(readFileSync(new URL("../fixtures/paypal-send-invoice-real.json", import.meta.url), "utf8")) as { respuesta: string };
    const paypal = paypalCon({ send_invoice: { execute: async () => fixture.respuesta } });
    await expect(paypal.enviar("INV2-27EX-CPU9-N7KF-F2VA")).resolves.toEqual({ href: "https://www.sandbox.paypal.com/invoice/p/#INV2-27EX-CPU9-N7KF-F2VA" });
  });

  it("acepta un objeto directo con el enlace QR", async () => {
    const paypal = paypalCon({
      generate_invoice_qr_code: { execute: async () => ({ image_url: "https://www.sandbox.paypal.com/invoice/qr/INV2-TEST-ABCD-1234" }) },
    });
    await expect(paypal.qr("INV2-TEST-ABCD-1234")).resolves.toEqual({ href: "https://www.sandbox.paypal.com/invoice/qr/INV2-TEST-ABCD-1234" });
  });

  it("extrae el PNG del multipart JSON que devuelve generate_invoice_qr_code", async () => {
    const fixture = JSON.parse(readFileSync(new URL("../fixtures/paypal-qr-multipart.json", import.meta.url), "utf8")) as { respuesta: string };
    const paypal = paypalCon({ generate_invoice_qr_code: { execute: async () => fixture.respuesta } });
    await expect(paypal.qr("INV2-TEST-ABCD-1234")).resolves.toEqual({ href: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9x7jYAAAAASUVORK5CYII=" });
  });

  it("rechaza una parte image que no es un PNG base64 válido", async () => {
    const multipartInvalido = "--oki-qr-boundary\r\nContent-Disposition: form-data; name=\"image\"\r\nContent-Type: text/plain\r\n\r\nZXN0bw==\r\n--oki-qr-boundary--\r\n";
    const paypal = paypalCon({ generate_invoice_qr_code: { execute: async () => JSON.stringify(multipartInvalido) } });
    await expect(paypal.qr("INV2-TEST-ABCD-1234")).rejects.toThrow("imagen PNG base64 inválida");
  });
});
