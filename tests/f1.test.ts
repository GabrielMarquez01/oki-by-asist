import { describe, expect, it } from "vitest";
import { cobrarVencidas, RedactorConRespaldo, RedactorPlantilla, seleccionarRedactor, type Redactor } from "../src/agente/cobrar.js";
import { consultarCobros } from "../src/agente/consultar.js";
import { modeloGemini, MODELO_GEMINI_PREDETERMINADO } from "../src/ia/modelo.js";
import { libroDemo } from "../src/libro/index.js";
import { PayPalReal, PayPalSimulado, type CobrosPayPal } from "../src/paypal/index.js";
import { evaluarPolitica, politicaDemo } from "../src/politica.js";

describe("F1 cobrar", () => {
  it("selecciona el modelo Gemini configurado o su único predeterminado", () => {
    expect(modeloGemini({})).toBe(MODELO_GEMINI_PREDETERMINADO);
    expect(modeloGemini({ OKI_GEMINI_MODEL: "gemini-prueba" })).toBe("gemini-prueba");
  });
  it("selecciona plantilla sin llave y Gemini con llave", () => {
    expect(seleccionarRedactor({}).estado()).toEqual({ tipo: "plantilla" });
    expect(seleccionarRedactor({ GOOGLE_GENERATIVE_AI_API_KEY: "llave-sintetica" }).estado()).toEqual({ tipo: "ia_viva" });
  });
  it("una falla del redactor usa plantilla sin afectar el flujo", async () => {
    const fallido: Redactor = { redactar: async () => { throw Object.assign(new Error("no usar"), { statusCode: 404 }); } };
    const cuenta = libroDemo().cuentas[0]; const redactor = new RedactorConRespaldo(fallido);
    await expect(redactor.redactar(cuenta, "https://demo.invalid/pago", "cercano", "en")).resolves.toContain("Hello Alma");
    expect(redactor.estado()).toEqual({ tipo: "ia_no_disponible", motivo: "HTTP 404" });
  });
  it("crea cobro con monto exacto y política parcial", async () => {
    const paypal = new PayPalSimulado(); const libro = libroDemo();
    await cobrarVencidas(libro, paypal, politicaDemo, new RedactorPlantilla());
    const cuenta = libro.cuentas[0]; const cobro = await paypal.consultar(cuenta.paypalInvoiceId ?? "");
    expect(cobro.amount.value).toBe("1200.00"); expect(cobro.allow_partial_payment).toBe(true);
  });
  it("exceso de política requiere aprobación", () => expect(evaluarPolitica(5001, politicaDemo)).toBe("requiere_aprobacion"));
  it("falla PayPal deja error y no redacta mensaje", async () => {
    const libro = libroDemo(); const mensajes = await cobrarVencidas(libro, new PayPalSimulado(true), politicaDemo, new RedactorPlantilla());
    expect(mensajes).toEqual([]); expect(libro.cuentas[0].estado).toBe("error");
  });
  it("niega PayPal real si no es SANDBOX", () => {
    const old = process.env.PAYPAL_ENVIRONMENT; process.env.PAYPAL_ENVIRONMENT = "LIVE";
    expect(() => new PayPalReal("id", "secret")).toThrow("SANDBOX"); process.env.PAYPAL_ENVIRONMENT = old;
  });
  it("consulta actualiza pago parcial", async () => {
    const paypal = new PayPalSimulado(); const libro = libroDemo(); await cobrarVencidas(libro, paypal, politicaDemo, new RedactorPlantilla());
    const id = libro.cuentas[0].paypalInvoiceId ?? ""; await paypal.registrarPagoExterno(id, { monto: 400, metodo: "BANK_TRANSFER", fecha: "2026-11-04" }); await consultarCobros(libro, paypal);
    expect(libro.cuentas[0].estado).toBe("parcial");
  });
  it("consulta baja el saldo con due_amount de PayPal", async () => {
    const libro = libroDemo(); const cuenta = libro.cuentas[0]; cuenta.paypalInvoiceId = "INV2-REAL-PARTIAL";
    const paypal: CobrosPayPal = {
      crear: async () => { throw new Error("not used"); }, enviar: async () => ({}), qr: async () => ({ href: "https://demo.invalid/qr" }), registrarPagoExterno: async () => {},
      consultar: async () => ({ id: "INV2-REAL-PARTIAL", status: "PARTIALLY_PAID", amount: { currency_code: "MXN", value: "1200.00" }, due_amount: { currency_code: "MXN", value: "720.00" }, allow_partial_payment: true }),
    };
    await consultarCobros(libro, paypal);
    expect(cuenta).toMatchObject({ estado: "parcial", saldo: 720 });
  });
  it("el mensaje usa el enlace de pago y nunca el QR como data URL", async () => {
    const paypal = new PayPalSimulado(); const libro = libroDemo();
    const mensajes = await cobrarVencidas(libro, paypal, politicaDemo, new RedactorPlantilla(), "en");
    expect(mensajes[0]).toContain("https://www.sandbox.paypal.com/invoice/payerView/details/INV-DEMO-1");
    expect(mensajes[0]).not.toContain("data:image/png;base64,");
  });
  it.fails("control mutante: una regla rota no debe autorizar sobre el tope", () => {
    const reglaRota = () => "autorizado"; expect(reglaRota()).toBe("requiere_aprobacion");
  });
});
