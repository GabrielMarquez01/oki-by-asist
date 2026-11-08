import{instrumentar}from "./provider.js";
import{presentar}from "./presentation.js";
import{libroDemo}from "../libro/index.js";
import{politicaDemo}from "../politica.js";
import{cobrarVencidas,seleccionarRedactor,type RedactorSeleccionado,type EstadoBorrador}from "../agente/cobrar.js";
import{AgenteConciliador}from "../agente/conciliar.js";
import{consultarCobros}from "../agente/consultar.js";
import{LectorComprobanteSimulado}from "../comprobantes/lector.js";
import{cuentaDestinoCoincide,empatarComprobante,type Conciliacion}from "../comprobantes/empatar.js";
import type{CobrosPayPal}from "../paypal/index.js";
import{idiomaActual,type Idioma}from "../i18n.js";
export const BRAND_NAME="OKI by AsisT";
export const politicaUI=politicaDemo;
export type Modo="simulado" | "sandbox";
type Historial={cuentaId:string;paso:string;resultado:"ok" | "error";hora:string};
export type Detalle={url?:string;qr?:string;mensaje?:string;enviado?:boolean;borrador?:EstadoBorrador};
type Recibo={conciliacion:Conciliacion;cerrado:boolean;rechazado:boolean};
export class ErrorUI extends Error{
constructor(readonly codigo:string,readonly status=409){super(codigo);}
}
export{crearProveedor}from "./provider.js";
export class DemoUI{
readonly libro;
readonly detalles:Record<string,Detalle>={};
readonly historial:Historial[]=[];
readonly recibos:Recibo[]=[];
readonly agente:AgenteConciliador;
private readonly paypal:CobrosPayPal;
private readonly lector:LectorComprobanteSimulado;
private readonly reservadas=new Set<string>();
constructor(readonly modo:Modo,proveedor:CobrosPayPal,readonly hoy=new Date(),private readonly elegirRedactor:()=>RedactorSeleccionado=seleccionarRedactor){
this.libro=libroDemo(hoy);this.lector=new LectorComprobanteSimulado(hoy);
this.paypal=instrumentar(proveedor,this.libro,this.detalles,(id,paso,resultado)=> this.evento(id,paso,resultado));
this.agente=new AgenteConciliador(this.libro,this.paypal);
}
private evento(cuentaId:string,paso:string,resultado:"ok" | "error"="ok"){
this.historial.push({cuentaId,paso,resultado,hora:new Date().toISOString()});
}
async cobrar(idioma:Idioma){
const redactor=this.elegirRedactor();
await cobrarVencidas(this.libro,this.paypal,politicaUI,{
redactar:async(cuenta,url,tono,lang)=>{
const mensaje=await redactor.redactor.redactar(cuenta,url,tono,lang);
this.detalles[cuenta.id]={...this.detalles[cuenta.id],url,mensaje,borrador:redactor.estado()};return mensaje;
},
},idioma);
for(const cuenta of this.libro.cuentas)if(cuenta.estado==="error")cuenta.motivoError="paypal";
}
enviar(cuentaId:string){
const detalle=this.detalles[cuentaId];
if(!detalle?.mensaje)throw new ErrorUI("collectFirst");
detalle.enviado=true;this.evento(cuentaId,"chat_demo");
}
async recibir(muestra:"bueno" | "otra-cuenta"){
if(!this.detalles["DEMO-001"]?.enviado)throw new ErrorUI("sendFirst");
const lectura=await this.lector.leer(`fixtures/comprobantes/${muestra}.json`);
const conciliacion=empatarComprobante(`CON-DEMO-${this.recibos.length + 1}`,lectura,this.libro,politicaUI,this.referencias());
this.recibos.push({conciliacion,cerrado:false,rechazado:false});
this.evento("DEMO-001","receipt_demo");
}
async aprobar(id:string,revisado:boolean,confirmado:boolean){
const recibo=this.buscar(id);
if(recibo.cerrado)throw new ErrorUI("closed");
const c=empatarComprobante(id,recibo.conciliacion.lectura,this.libro,politicaUI,this.referencias(id));
recibo.conciliacion=c;
if([c.lectura.referencia,c.lectura.claveRastreo].some(s=>!!s&&this.referencias(id).includes(s)))throw new ErrorUI("duplicate");
if(!cuentaDestinoCoincide(c.lectura.cuentaBeneficiaria,politicaUI))throw new ErrorUI("destination");
if(c.estado==="sospechoso" &&(!revisado || !confirmado))throw new ErrorUI("reviewFirst");
if(revisado && c.estado !=="sospechoso")throw new ErrorUI("reviewFirst");
recibo.cerrado=true;
this.reservadas.add(c.lectura.referencia);
if(c.lectura.claveRastreo)this.reservadas.add(c.lectura.claveRastreo);
this.evento(c.cuentaId ?? "DEMO-001","owner_approval");
if(revisado)await this.agente.aprobarRevisado(c);else await this.agente.aprobar(c);
if(c.estado==="error")throw new ErrorUI("paypal",502);
try{await consultarCobros({cuentas:this.libro.cuentas.filter(cuenta=> this.detalles[cuenta.id]?.url)},this.paypal);}
catch{throw new ErrorUI("balance",502);}
}
rechazar(id:string){
const recibo=this.buscar(id);if(recibo.cerrado)throw new ErrorUI("closed");
recibo.cerrado=true;recibo.rechazado=true;
}
private buscar(id:string):Recibo{
const recibo=this.recibos.find(r=> r.conciliacion.id===id);
if(!recibo)throw new ErrorUI("missing",404);return recibo;
}
private referencias(antesDe?:string):string[]{
const indice=antesDe===undefined ? this.recibos.length:this.recibos.findIndex(r=> r.conciliacion.id===antesDe);
const pendientes=this.recibos.slice(0,indice).filter(r=> !r.cerrado).flatMap(r=> [r.conciliacion.lectura.referencia,r.conciliacion.lectura.claveRastreo].filter((s):s is string=> !!s));
return [...new Set([...this.agente.referenciasUsadas,...this.reservadas,...pendientes])];
}
estado(idioma:Idioma=idiomaActual()){
return presentar(this,idioma,politicaUI,c=> this.referencias(c.id));
}
}
