import { cuentaDestinoCoincide, type Conciliacion } from "../comprobantes/empatar.js";
import type { Politica } from "../politica.js";
import type { Idioma } from "../i18n.js";
import { BRAND_NAME, type DemoUI } from "./state.js";

export function presentar(demo: DemoUI, idioma: Idioma, politica: Politica, referencias: (c: Conciliacion) => string[]) {
    const recibos = demo.recibos.map(recibo => {
      const c = recibo.conciliacion; const l = c.lectura;
      const cuenta = demo.libro.cuentas.find(cuenta => cuenta.id === c.cuentaId);
      return { ...recibo, reglas: [
        { id: "confidence", ok: l.confianza >= politica.confianzaMinima },
        { id: "reference", ok: ![l.referencia, l.claveRastreo].some(s => !!s && referencias(c).includes(s)) || (recibo.cerrado && !recibo.rechazado && c.estado !== "sospechoso") },
        { id: "date", ok: !!cuenta && Math.abs(Date.parse(l.fecha) - Date.parse(cuenta.vencimiento)) / 86400000 <= politica.ventanaComprobanteDias },
        { id: "amount", ok: !!cuenta && l.monto <= (recibo.cerrado && !recibo.rechazado ? cuenta.saldo + l.monto : cuenta.saldo) },
        { id: "destination", ok: cuentaDestinoCoincide(l.cuentaBeneficiaria, politica) },
      ] };
    });
    return { brand: BRAND_NAME, modo: demo.modo, idioma, actualizado: new Date().toISOString(), libro: demo.libro,
      politica: politica, detalles: demo.detalles, historial: demo.historial, recibos,
      porAprobar: recibos.filter(r => !r.cerrado).length };
}
