// Demo pública del cómputo (fugapy.com/computo): el mismo motor de computo.fugapy.com, corriendo en el navegador.
// La página es la de servidor/publico; este archivo atiende las 5 rutas /api/* que usa, sin servidor y sin link personal.
// El plano no sale de la compu de quien lo sube.
const { computar, recalcular } = require('../fuga-computo/src/computar.js');
const { corregir, supuestosQueValen } = require('../fuga-computo/src/correcciones.js');
const { validar } = require('../fuga-computo/src/supuestos.js');
const { armarVista } = require('../fuga-computo/servidor/vista.js');
const Dwg = require('../fuga-computo/src/dwg.js');

const REGLAS = '2026-10-30b';
const MB = 1024 * 1024;
const MAX_BYTES = 60 * MB;
const LIBREDWG = new URL('libredwg/', document.currentScript ? document.currentScript.src : location.href).href;

let lector = null;
const cargarLibreDwg = () => lector || (lector = import(LIBREDWG + 'dist/libredwg-web.js')
  .then(async (m) => {
    const lib = await m.LibreDwg.create(LIBREDWG + 'wasm/');
    return Dwg.lectorLibreDwg(lib, m.Dwg_File_Type.DWG);
  })
  .catch((e) => { lector = null; throw e; }));

// lo que el servidor guarda de cada cómputo (servidor/computos.js), acá en memoria y como JSON plano (igual que la base empacada)
const computos = new Map();
const lista = (v) => (Array.isArray(v) ? v : []);
const reglas = (sectores) => lista(sectores).filter((s) => s && typeof s === 'object').map((s) => ({
  nombre: String(s.nombre),
  supuestos: lista(s.supuestos).filter((d) => d && typeof d === 'object').map((d) => ({
    clave: String(d.clave), texto: String(d.texto), tipo: d.tipo === 'opcion' ? 'opcion' : 'numero', min: d.min, max: d.max, paso: d.paso,
    rango: d.rango == null ? null : String(d.rango), opciones: lista(d.opciones).map((o) => ({ valor: o && o.valor })),
    base: { valor: d.base && typeof d.base === 'object' ? d.base.valor : null },
  })),
}));
const idNuevo = () => {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22);
};
const objetoPlano = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers) });
const falla = (status, codigo, mensaje) => json({ error: { codigo, mensaje } }, status);
const espera = () => new Promise((r) => setTimeout(r, 30));

async function apiComputar(init) {
  const h = new Headers(init.headers || {});
  const unidad = h.get('X-Unidad') || undefined;
  const buf = await new Response(init.body).arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return falla(413, 'grande', 'El archivo pasa de 60 MB.');
  await espera(); // que la pantalla muestre el progreso antes de que el motor ocupe el hilo
  let dibujos = null;
  const r = await computar(new Uint8Array(buf), { cargarLibreDwg, unidad, alClasificar: (d) => { dibujos = d; } });
  const vista = armarVista(r);
  if (r.error) return json(vista);
  const base = JSON.parse(JSON.stringify({ panel: r.panelEntero, avisos: lista(r.avisosLectura), unidad: r.unidad, dibujos: lista(dibujos) }));
  const id = idNuevo();
  computos.set(id, { base, sectores: reglas(vista.sectores) });
  return json(vista, 200, { 'X-Computo': id });
}

const MENSAJE = {
  pedido: 'No entendí el pedido. Recargá la página y probá de nuevo.',
  computo: 'Este cómputo ya no está. Subí el plano de nuevo para cambiar los supuestos.',
  interno: 'No pude recalcular. Probá de nuevo.',
};

async function apiRecalcular(init) {
  let pedido = null;
  try { pedido = JSON.parse(await new Response(init.body).text()); } catch (e) { /* no es JSON */ }
  if (!objetoPlano(pedido) || typeof pedido.computo !== 'string') return falla(400, 'pedido', MENSAJE.pedido);
  const hallado = computos.get(pedido.computo);
  if (!hallado) return falla(404, 'computo', MENSAJE.computo);
  const conCorrecciones = Array.isArray(pedido.correcciones) && pedido.correcciones.length > 0;
  const previa = validar(pedido.supuestos, new Map(hallado.sectores.map((s) => [s.nombre, s.supuestos])));
  if (!previa.ok && !conCorrecciones) return falla(400, 'supuesto', previa.mensaje);
  await espera();
  let x, aplicadas = null;
  try {
    let base = hallado.base;
    if (conCorrecciones) {
      const c = corregir(base.dibujos, pedido.correcciones, { avisos: base.avisos, unidad: base.unidad, revision: null });
      if (c.error === 'correccion') return falla(400, 'correccion', c.mensaje);
      if (c.error) throw new Error(c.detalle || c.error);
      aplicadas = c.aplicadas;
      base = { panel: c.resultado.panelEntero, avisos: base.avisos, unidad: base.unidad };
    }
    const sup = conCorrecciones ? supuestosQueValen(base.panel, pedido.supuestos) : pedido.supuestos;
    x = recalcular(base, sup);
    if (x.error === 'supuesto' && conCorrecciones) return falla(400, 'supuesto', x.mensaje);
  } catch (err) { x = { error: 'interno', detalle: String(err && err.message) }; }
  if (x.error) { console.warn('[demo] recalcular', x); return falla(500, 'interno', MENSAJE.interno); }
  const vista = armarVista(x.resultado);
  if (vista.error) return falla(500, 'interno', MENSAJE.interno);
  if (aplicadas) vista.correcciones = aplicadas;
  return json(vista, 200, { 'X-Computo': pedido.computo });
}

// Un día de uso (Alex, 17/11/2026): las 24 horas corren desde que se abre la demo por primera vez en ese navegador, como los 7 días
// de los links de computo.fugapy.com, que empiezan con el primer pedido a la API.
const DURACION = 24 * 3600 * 1000;
const CLAVE = 'fuga-computo-demo-inicio';
let inicioEnMemoria = 0;
function inicioDemo() {
  try {
    let t = Number(localStorage.getItem(CLAVE));
    if (!t) { t = Date.now(); localStorage.setItem(CLAVE, String(t)); }
    return t;
  } catch (e) {
    return inicioEnMemoria || (inicioEnMemoria = Date.now());
  }
}
const MENSAJE_VENCIDA = 'La demo venció: se puede usar un día desde que la abrís. Escribinos al WhatsApp 0971 857 198 para seguir usando el cómputo.';

const original = window.fetch.bind(window);
window.fetch = async function (recurso, init = {}) {
  const url = new URL(typeof recurso === 'string' ? recurso : recurso.url, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return original(recurso, init);
  const vence = inicioDemo() + DURACION;
  if (Date.now() > vence) return falla(410, 'vencido', MENSAJE_VENCIDA);
  try {
    switch (url.pathname) {
      case '/api/estado':
        return json({ nombre: 'Demo beta', vence: new Date(vence).toISOString(), reglas: REGLAS, aceptadas: true });
      case '/api/aceptar': return json({ aceptadas: true });
      case '/api/computar': return await apiComputar(init);
      case '/api/recalcular': return await apiRecalcular(init);
      case '/api/sugerencia':
        return falla(503, 'demo', 'En la demo las sugerencias no se guardan. Escribinos al WhatsApp 0971 857 198.');
      case '/api/planos':
        if ((init.method || 'GET').toUpperCase() === 'GET') return json({ pedidos: [] });
        return falla(503, 'demo', 'En la demo no se reciben pedidos de planos. Para pedir uno, escribinos al WhatsApp 0971 857 198.');
      default: return falla(404, 'no_esta', 'no está');
    }
  } catch (err) {
    console.error('[demo]', err);
    return falla(500, 'interno', 'Algo falló en la demo. Probá de nuevo.');
  }
};
