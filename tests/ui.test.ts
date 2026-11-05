import{describe,expect,it}from "vitest";
import{iniciar}from "./http-harness.js";
import{crearProveedor,DemoUI}from "../src/ui/state.js";
import{libroDemo}from "../src/libro/index.js";
import{PayPalSimulado}from "../src/paypal/index.js";
describe("UI: HTTP sin sockets",()=>{
it("recorrido, doble envío y reset",async()=>{
const{request,post,recibir,preparar}=await iniciar();
const initial=await(await request("/api/estado")).json();
    expect(await (await request("/")).text()).toMatch(/DEMO · PayPal (simulated|simulado)/);
expect(initial).toMatchObject({modo:"simulado",porAprobar:0});expect(initial.libro.cuentas).toHaveLength(6);
await preparar();const data=await recibir();
expect(data.libro.cuentas[0].saldo).toBe(1200);expect(data.porAprobar).toBe(1);
expect(data.recibos[0].reglas.every((r:{ok:boolean})=>r.ok)).toBe(true);
const id=data.recibos[0].conciliacion.id;
const results=await Promise.all([post("aprobar",{id}),post("aprobar",{id})]);
expect(results.map(r=>r.status).sort()).toEqual([200,409]);
const c=(await recibir()).recibos[1].conciliacion;
expect(c).toMatchObject({estado:"sospechoso",motivo:"referencia_ya_usada"});
expect((await post("aprobar",{id:c.id,revisado:true,confirmado:true})).body.error).toBe("duplicate");
const final=(await post("rechazar",{id:c.id})).body;
expect(final.libro.cuentas[0]).toMatchObject({saldo:600,estado:"parcial"});
expect(final.historial.filter((h:{paso:string})=>h.paso==="record_payment_for_invoice")).toHaveLength(1);
expect(final.detalles["DEMO-001"].mensaje).toContain("Hola Alma");
const reset=(await post("reiniciar")).body;
expect(reset.recibos).toEqual([]);expect(reset.libro.cuentas[0].saldo).toBe(1200);
});
it("segundo pendiente sospechoso; un solo registro",async()=>{
const{post,recibir,preparar,demo}=await iniciar();await preparar();await recibir();
demo().recibos[0].conciliacion.lectura.referencia +=" primer envío";
const data=await recibir();
expect(data.recibos[0].conciliacion.estado).toBe("por_confirmar");
expect(data.recibos[1].conciliacion).toMatchObject({estado:"sospechoso",motivo:"referencia_ya_usada"});
expect(data.recibos.map((r:{reglas:{id:string;ok:boolean}[]})=>r.reglas.find(x=>x.id==="reference")!.ok)).toEqual([true,false]);
expect(data.libro.cuentas[0].saldo).toBe(1200);
demo().recibos[1].conciliacion.lectura.confianza=.2;
const results=await Promise.all(demo().recibos.map((r,i)=>post("aprobar",{id:r.conciliacion.id,revisado:i===1,confirmado:true})));
expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(demo().libro.cuentas[0].saldo).toBe(600);
});
it("otra cuenta: aprobación bloqueada y rechazo",async()=>{
const{post,recibir,preparar}=await iniciar();await preparar();const data=await recibir("otra-cuenta"),c=data.recibos[0].conciliacion;
expect(c.motivo).toBe("cuenta_destino_distinta");expect(data.recibos[0].reglas.at(-1).ok).toBe(false);
for(const campos of [{},{revisado:true}])expect((await post("aprobar",{id:c.id,...campos})).status).toBe(409);
expect((await post("rechazar",{id:c.id})).body.libro.cuentas[0].saldo).toBe(1200);
});
it.each(["otra-cuenta","ilegible","confianza-baja"])("%s: revisado no cambia saldo ni registra",async muestra=>{
const{post,recibir,preparar,demo}=await iniciar();await preparar();await recibir(muestra==="otra-cuenta"?muestra:"bueno");
const c=demo().recibos[0].conciliacion;
if(muestra==="ilegible")c.lectura.cuentaBeneficiaria=undefined;
if(muestra==="confianza-baja"){c.lectura.confianza=.2;c.lectura.cuentaBeneficiaria="000000000000000650";}
expect(await post("aprobar",{id:c.id,revisado:true,confirmado:true})).toMatchObject({status:409,body:{error:"destination"}});
expect(demo().recibos[0].conciliacion.motivo).toBe(muestra==="ilegible"?"cuenta_destino_ilegible":muestra==="confianza-baja"?"confianza_baja":"cuenta_destino_distinta");
await expect(demo().agente.aprobarRevisado(demo().recibos[0].conciliacion)).rejects.toThrow("cuenta destino");
expect(demo().libro.cuentas[0].saldo).toBe(1200);
expect(demo().historial.some(h=>h.paso==="record_payment_for_invoice")).toBe(false);
});
it("sandbox conserva libro; solo consulta ids de sesión",async()=>{
const paypal=new PayPalSimulado(),consultar=paypal.consultar.bind(paypal),ids:string[]=[];
paypal.consultar=async id=>{ids.push(id);expect(id).not.toBe("INV-DEMO-PARCIAL");return consultar(id);};
const hoy=new Date("2026-11-05T12:00:00Z"),demo=new DemoUI("sandbox",paypal,hoy);
expect(demo.libro).toEqual(libroDemo(hoy));
await demo.cobrar("es");demo.enviar("DEMO-001");await demo.recibir("bueno");await demo.aprobar(demo.recibos[0].conciliacion.id,false,false);
expect(demo.libro.cuentas[0]).toMatchObject({saldo:600,estado:"parcial"});expect(demo.libro.cuentas[1].estado).toBe("por_confirmar");
expect(demo.libro.cuentas[4].paypalInvoiceId).toBe("INV-DEMO-PARCIAL");
expect(ids).toEqual(["INV-DEMO-1","INV-DEMO-1","INV-DEMO-1","INV-DEMO-2"]);
});
it("subidas, rutas y origen",async()=>{
const{request,post}=await iniciar();
expect((await post("recibir",{muestra:"bueno"})).body.error).toBe("sendFirst");
for(const campos of [{muestra:"../../.env"},{muestra:"bueno",archivo:"datos"}])expect((await post("recibir",campos)).status).toBe(400);
expect((await request("/api/accion","POST",'{"accion":"reiniciar"}',{origin:"https://example.invalid","content-type":"application/json"})).status).toBe(403);
expect((await request("/src/ui/state.ts")).status).toBe(404);expect((await request("/api/accion","POST","file")).status).toBe(415);
for(const p of ["/","/app.js","/copy.js","/styles.css","/brand.png"])expect((await request(p)).status).toBe(200);
});
it("error privado no llega al cliente",async()=>{
const paypal=new PayPalSimulado();paypal.crear=async()=>{throw new Error("texto-privado-sintetico");};
const{post}=await iniciar(paypal),data=(await post("cobrar",{idioma:"en"})).body;
expect(data.libro.cuentas[0].estado).toBe("error");expect(JSON.stringify(data)).not.toContain("texto-privado-sintetico");
expect((await post("enviar",{cuentaId:"DEMO-001"})).status).toBe(409);
});
it("saldo consultado y respuesta perdida",async()=>{
const paypal=new PayPalSimulado(),consultar=paypal.consultar.bind(paypal),registrar=paypal.registrarPagoExterno.bind(paypal);let registrado=false;
paypal.registrarPagoExterno=async(id,pago)=>{await registrar(id,pago);registrado=true;};
paypal.consultar=async id=>{const c=await consultar(id);return registrado&&id==="INV-DEMO-1"?{...c,due_amount:{currency_code:"MXN",value:"720.00"}}:c;};
const{post,recibir,preparar}=await iniciar(paypal);await preparar();const c=(await recibir()).recibos[0].conciliacion;
expect((await post("aprobar",{id:c.id})).body.libro.cuentas[0].saldo).toBe(720);
await post("reiniciar");registrado=false;await preparar();const nuevo=(await recibir()).recibos[0].conciliacion;
paypal.registrarPagoExterno=async()=>{registrado=true;};paypal.consultar=async()=>{throw new Error("respuesta perdida");};
expect((await post("aprobar",{id:nuevo.id})).status).toBe(502);expect((await recibir()).recibos[1].conciliacion.motivo).toBe("referencia_ya_usada");
});
it("modos y configuración",()=>{
expect(crearProveedor({}).modo).toBe("simulado");const previo=process.env.PAYPAL_ENVIRONMENT;
try{
const proveedor=crearProveedor({PAYPAL_CLIENT_ID:"cliente-sintetico",PAYPAL_CLIENT_SECRET:"valor-sintetico"});expect(proveedor.modo).toBe("sandbox");
const hoy=new Date("2026-11-05T12:00:00Z"),demo=new DemoUI(proveedor.modo,proveedor.paypal,hoy);
expect(demo.libro).toEqual(libroDemo(hoy));expect(demo.libro).toEqual(new DemoUI("simulado",new PayPalSimulado(),hoy).libro);
}finally{if(previo===undefined)delete process.env.PAYPAL_ENVIRONMENT;else process.env.PAYPAL_ENVIRONMENT=previo;}
expect(()=>crearProveedor({PAYPAL_CLIENT_ID:"sintetico"})).toThrow();
expect(()=>crearProveedor({PAYPAL_CLIENT_ID:"sintetico",PAYPAL_CLIENT_SECRET:"sintetico",PAYPAL_ENVIRONMENT:"LIVE"})).toThrow();
});
});
