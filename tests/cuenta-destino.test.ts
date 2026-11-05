import{readFileSync}from "node:fs";
import{stripTypeScriptTypes}from "node:module";
import{z}from "zod";
import{describe,expect,it}from "vitest";
import{empatarComprobante as empatar}from "../src/comprobantes/empatar.js";
import type{LecturaComprobante}from "../src/comprobantes/lector.js";
import{libroDemo}from "../src/libro/index.js";
import{politicaDemo}from "../src/politica.js";
const hoy=new Date("2026-11-05T12:00:00Z");
const politica=politicaDemo;
const lectura:LecturaComprobante={monto:600,moneda:"MXN",fecha:"2026-11-04",metodo:"spei",referencia:"DEMO-001 transferencia",confianza:.99,demo:true,cuentaBeneficiaria:politica.cuentasCobro[0]};
const distinta={...lectura,cuentaBeneficiaria:"000000000000000650"};
const rechaza=(evaluar:typeof empatar)=> expect(evaluar("CON-CUENTA",distinta,libroDemo(hoy),politica)).toMatchObject({estado:"sospechoso",motivo:"cuenta_destino_distinta",cuentaId:"DEMO-001"});
const original=readFileSync(new URL("../src/comprobantes/empatar.ts",import.meta.url),"utf8");
const mutado = original.replace(/^  if \(!cuentaDestinoCoincide\(lectura\.cuentaBeneficiaria, politica\)\).*\n/m, "");
if(mutado===original)throw new Error("No se pudo desactivar la regla real");
const codigo = stripTypeScriptTypes(mutado.replace(/^import .*\n/gm, "").replace(/\bexport /g, ""));
const mutante=new Function("z",`${codigo}\nreturn empatarComprobante;`)(z)as typeof empatar;
describe("cuenta destino",()=>{
it.each([politica.cuentasCobro[0],"1200"])("acepta cuenta declarada: %s",cuentaBeneficiaria=>{
expect(empatar("CON-OK",{...lectura,cuentaBeneficiaria},libroDemo(hoy),politica).estado).toBe("por_confirmar");
});
it("marca otra cuenta",()=> rechaza(empatar));
it("CLABE exige igualdad completa",()=>{
expect(empatar("CON-CLABE",{...lectura,cuentaBeneficiaria:"100000000000001200"},libroDemo(hoy),politica).motivo).toBe("cuenta_destino_distinta");
});
it("cuenta ilegible: motivo propio",()=>{
const sinCuenta={...lectura,cuentaBeneficiaria:undefined};
expect(empatar("CON-SIN",sinCuenta,libroDemo(hoy),politica)).toMatchObject({estado:"sospechoso",motivo:"cuenta_destino_ilegible"});
expect(()=> expect(mutante("CON-SIN",sinCuenta,libroDemo(hoy),politica).motivo).toBe("cuenta_destino_ilegible")).toThrow();
});
it.each([undefined,lectura.cuentaBeneficiaria,distinta.cuentaBeneficiaria])("sin cuentas, no aplica: %s",cuentaBeneficiaria=>{
expect(empatar("CON-SIN-POLITICA",{...lectura,cuentaBeneficiaria},libroDemo(hoy),{...politica,cuentasCobro:[]}).estado).toBe("por_confirmar");
});
it("prioridad de referencia y monto",()=>{
expect(empatar("CON-REF",distinta,libroDemo(hoy),politica,[lectura.referencia]).motivo).toBe("referencia_ya_usada");
expect(empatar("CON-MONTO",{...distinta,monto:1201},libroDemo(hoy),politica).motivo).toBe("monto_distinto_o_mayor_al_saldo");
});
it("mutante permite otra cuenta",()=>{
expect(mutante("CON-MUT",distinta,libroDemo(hoy),politica).estado).toBe("por_confirmar");
});
it.fails("control mutante: falla el rechazo",()=> rechaza(mutante));
});
