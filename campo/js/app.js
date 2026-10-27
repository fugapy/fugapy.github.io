// FUGA Campo — app de relevamiento. Pantallas, navegación y eventos.

import * as db from './db.js';
import * as M from './modelo.js';
import * as P from './plano.js';
import { grabador, abrirCamara, cerrarStream, sacarFoto, empezarNota } from './media.js';
import { archivosDelPaquete, nombrePaquete, resumenCliente } from './exportar.js';
import { armarZip } from './zip.js';

const app = document.getElementById('app');

const E = {
  obra: null,
  vista: 'lista',
  ambId: null,
  campo: 'A', // medida activa
  tipoFoto: 'general',
  abertura: null, // id de la abertura que se edita
  sel: null, // ambiente elegido en el plano
  galeria: null, // { amb, foto }
  ultimaFoto: null,
  instalar: null,
  exportando: false,
};

let camara = null; // stream abierto en la pantalla de fotos

// --- Íconos (trazo, 24 px) ----------------------------------------------------

const svg = (d, t = 22, w = 2) => `<svg aria-hidden="true" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  atras: svg('<path d="M15 18l-6-6 6-6"></path>'),
  sig: svg('<path d="M9 18l6-6-6-6"></path>', 18),
  mas: svg('<path d="M12 5v14M5 12h14"></path>', 20, 2.4),
  equis: svg('<path d="M6 6l12 12M18 6L6 18"></path>', 16, 2.4),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"></path>', 16, 2.8),
  camara: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"></path><circle cx="12" cy="13" r="3.5"></circle>'),
  mic: svg('<rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path>', 24),
  micGrande: svg('<rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path>', 52, 1.8),
  pin: svg('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"></path><circle cx="12" cy="10" r="2.5"></circle>', 20),
  imagen: svg('<rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M4 16l5-5 4 4 2-2 5 5"></path>'),
  enviar: svg('<path d="M4 12l16-8-6 16-2-7z"></path>', 20),
  aviso: svg('<path d="M12 4l9 16H3z"></path><path d="M12 10v4M12 17v.5"></path>', 20),
  plano: svg('<rect x="3" y="3" width="18" height="18" rx="1"></rect><path d="M3 10h8V3M11 10v11M11 15h10"></path>'),
  pausa: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="6" width="3.5" height="12" rx="1"></rect><rect x="13.5" y="6" width="3.5" height="12" rx="1"></rect></svg>',
  play: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"></path></svg>',
  sinSenal: svg('<path d="M3 3l18 18"></path><path d="M7.5 8.2A5 5 0 0 0 7 18h10"></path><path d="M19.4 16.5A4 4 0 0 0 16 10h-.6A6 6 0 0 0 10.5 6.2"></path>', 20),
  girar: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 4v7h-7"></path>', 18),
  bajar: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"></path>', 20),
  copiar: svg('<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"></path>', 20),
};

// --- Ayudas ----------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ruta = (vista, amb) => `#/o/${E.obra.id}/${vista}${amb ? `/${amb}` : ''}`;
const amb = () => E.obra?.ambientes.find((a) => a.id === E.ambId) || null;
const grabandoAca = () => grabador.estado !== 'quieto' && grabador.obra?.id === E.obra?.id;

function tostada(texto, ms = 2600) {
  document.querySelector('.tostada')?.remove();
  const t = document.createElement('div');
  t.className = 'tostada';
  t.setAttribute('role', 'status');
  t.textContent = texto;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

const relojes = new Map();
function guardarLuego(obra = E.obra) {
  if (!obra) return;
  obra.actualizada = M.ahoraISO();
  clearTimeout(relojes.get(obra.id));
  relojes.set(obra.id, setTimeout(() => {
    relojes.delete(obra.id);
    db.guardarObra(obra).catch((e) => tostada(`No se pudo guardar: ${e.message}`));
  }, 350));
}
async function guardarYa(obra = E.obra) {
  if (!obra) return;
  clearTimeout(relojes.get(obra.id));
  relojes.delete(obra.id);
  await db.guardarObra(obra);
}

const urls = new Map();
async function urlBlob(id) {
  if (urls.has(id)) return urls.get(id);
  const b = await db.blob(id);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(id, u);
  return u;
}
function soltarUrls() {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}
async function pintarImagenes(raiz = app) {
  for (const el of raiz.querySelectorAll('[data-blob]')) {
    const u = await urlBlob(el.dataset.blob);
    if (!u) continue;
    if (el.tagName === 'IMG') el.src = u;
    else el.style.backgroundImage = `url("${u}")`;
  }
}

function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// --- Navegación --------------------------------------------------------------------

function leerRuta() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'o' && p[1]) return { obraId: p[1], vista: p[2] || 'ficha', ambId: p[3] || null };
  return { vista: 'lista' };
}

async function navegar() {
  const r = leerRuta();
  if (E.vista === 'fotos' && r.vista !== 'fotos') apagarCamara();
  if (r.obraId) {
    if (!E.obra || E.obra.id !== r.obraId) {
      if (E.obra) await guardarYa();
      soltarUrls();
      const o = grabador.obra?.id === r.obraId ? grabador.obra : await db.obra(r.obraId);
      if (!o) { location.hash = '#/'; return; }
      recuperarGrabaciones(o);
      E.obra = o;
      E.ambId = null;
      E.sel = null;
      E.ultimaFoto = o.fotos.at(-1)?.id || null;
    }
    const valido = E.obra.ambientes.some((a) => a.id === r.ambId);
    if (valido) E.ambId = r.ambId;
    if (!E.obra.ambientes.some((a) => a.id === E.ambId)) {
      const lista = r.vista === 'medidas' ? M.ambientesAMedir(E.obra) : E.obra.ambientes;
      E.ambId = (lista[0] || E.obra.ambientes[0])?.id || null;
    }
    if (r.vista === 'medidas' && amb() && !amb().medir && !valido) {
      E.ambId = M.ambientesAMedir(E.obra)[0]?.id || E.ambId;
    }
  } else {
    if (E.obra) await guardarYa();
    E.obra = null;
  }
  E.vista = r.vista;
  E.abertura = null;
  E.galeria = null;
  await pintar();
  window.scrollTo(0, 0);
}

// Si el navegador se cerró grabando, la charla quedó a medias: se cierra con lo guardado.
function recuperarGrabaciones(o) {
  for (const g of o.grabaciones) {
    if (g.activa && !(grabador.g && grabador.g.id === g.id)) {
      g.activa = false;
      if (!g.duracion) g.duracion = (g.trozos || 0) * 5;
      g.recuperada = true;
    }
  }
}

async function pintar() {
  document.body.classList.toggle('oscuro', E.vista === 'fotos');
  const vistas = { lista: vistaLista, ficha: vistaFicha, fotos: vistaFotos, medidas: vistaMedidas, plano: vistaPlano, voz: vistaVoz, resumen: vistaResumen };
  const fn = E.obra || E.vista === 'lista' ? vistas[E.vista] || vistaFicha : vistaLista;
  app.innerHTML = await fn();
  if (E.galeria) app.insertAdjacentHTML('beforeend', vistaGaleria());
  await despues[E.vista]?.();
  pintarImagenes();
  actualizarRelojes();
}

// --- Partes comunes ----------------------------------------------------------------

function relojHtml(enlace = true) {
  if (grabador.estado === 'quieto') return '';
  const clase = grabador.estado === 'pausa' ? 'reloj pausa' : 'reloj';
  const t = M.mmss(grabador.segundos());
  const titulo = grabador.estado === 'pausa' ? 'Grabación en pausa' : 'Grabando la charla';
  if (!enlace) return `<span class="${clase}" data-reloj title="${titulo}">${t}</span>`;
  return `<a class="${clase}" data-reloj href="#/o/${grabador.obra.id}/voz" title="${titulo}">${t}</a>`;
}

function cabeza(vista) {
  const pasos = [['ficha', 'Ficha'], ['fotos', 'Fotos'], ['medidas', 'Medidas'], ['voz', 'Voz'], ['resumen', 'Resumen']];
  const actual = vista === 'plano' ? 'medidas' : vista;
  return `<header class="cabeza">
    <div class="cabeza-fila">
      <a class="volver" href="#/" aria-label="Volver a mis relevamientos">${I.atras}</a>
      <h1>${esc(E.obra.nombre || 'Obra nueva')}</h1>
      ${relojHtml()}
    </div>
    <nav class="pasos" aria-label="Pasos del relevamiento">
      ${pasos.map(([k, t]) => `<a href="${ruta(k, k === 'fotos' || k === 'medidas' ? E.ambId : null)}"${k === actual ? ' aria-current="page"' : ''}>${t}</a>`).join('')}
    </nav>
  </header>`;
}

function actualizarRelojes() {
  for (const el of document.querySelectorAll('[data-reloj]')) {
    el.textContent = M.mmss(grabador.segundos());
    el.classList.toggle('pausa', grabador.estado === 'pausa');
  }
}
setInterval(() => { if (grabador.estado !== 'quieto') actualizarRelojes(); }, 1000);

// --- 1 · Mis relevamientos ------------------------------------------------------------

async function vistaLista() {
  const obras = await db.obras();
  const hoy = M.ahoraISO().slice(0, 10);
  const tarjeta = (o) => {
    const fotos = o.fotos.length;
    const min = Math.round(o.grabaciones.reduce((s, g) => s + (g.duracion || 0), 0) / 60);
    const pend = o.pendientes.filter((p) => !p.hecho).length;
    const aMedir = M.ambientesAMedir(o);
    const medidos = aMedir.filter(M.estaMedido).length;
    const estado = o.exportada
      ? `<span class="estado mandado">${I.check}Mandado</span>`
      : `<span class="estado curso">En curso</span>`;
    const fecha = o.creada.slice(0, 10) === hoy ? `hoy ${o.creada.slice(11, 16)}` : o.creada.slice(0, 10).split('-').reverse().join('/');
    return `<a class="tarjeta" href="#/o/${o.id}/${o.exportada ? 'resumen' : 'ficha'}">
      <div class="fila" style="justify-content: space-between; align-items: flex-start">
        <div class="pila" style="gap: 4px; min-width: 0">
          <b style="font-family: var(--display); font-size: 19px">${esc(o.nombre || 'Obra sin nombre')}</b>
          <span class="ayuda">${esc(o.cliente || 'Sin cliente')} · ${fecha}</span>
        </div>
        ${estado}
      </div>
      <div class="grilla-3">
        <div class="dato"><b>${fotos}</b><span>fotos</span></div>
        <div class="dato"><b>${medidos}/${aMedir.length}</b><span>medidos</span></div>
        <div class="dato"><b>${pend}</b><span>pendientes${min ? ` · ${min} min` : ''}</span></div>
      </div>
    </a>`;
  };
  const enCurso = grabador.estado !== 'quieto'
    ? `<a class="aviso mal" href="#/o/${grabador.obra.id}/voz" style="text-decoration: none">${I.mic}<span>Estás grabando la charla de <b>${esc(grabador.obra.nombre || 'una obra')}</b>. Tocá para volver.</span></a>`
    : '';
  const esp = await db.espacio();
  const espTxt = esp && esp.total ? `Usás ${(esp.usado / 1e6).toFixed(0)} MB de ${(esp.total / 1e9).toFixed(1)} GB disponibles en el celular.` : '';
  return `<header class="cabeza" style="border-bottom: 0">
      <div class="pila" style="gap: 4px; padding-top: 10px">
        <span class="titulo-seccion" style="letter-spacing: 0.12em">FUGA · Campo</span>
        <h1 style="font-size: 32px; white-space: normal">Mis relevamientos</h1>
      </div>
    </header>
    <main class="cuerpo">
      ${enCurso}
      <button class="boton primario" data-a="nuevaObra">${I.mas}Nuevo relevamiento</button>
      ${obras.length ? `<section class="pila" style="gap: 10px"><h2 class="titulo-seccion">Obras</h2>${obras.map(tarjeta).join('')}</section>`
        : '<div class="vacio">Todavía no relevaste ninguna obra.<br>Tocá <b>Nuevo relevamiento</b> al llegar.</div>'}
      ${E.instalar ? `<button class="boton" data-a="instalar">${I.bajar}Instalar en el celular</button>` : ''}
      <div class="aviso info" style="margin-top: auto">${I.sinSenal}<span>Funciona sin señal. Fotos, medidas y audios quedan guardados en el celular hasta que los mandes al estudio. ${espTxt}</span></div>
    </main>`;
}

// --- 2 · Ficha ------------------------------------------------------------------------

function vistaFicha() {
  const o = E.obra;
  const u = o.ubicacion;
  const ubic = u
    ? `<b style="font-size: 15px">Ubicación guardada · ±${Math.round(u.precision_m)} m</b><span class="ayuda">${u.lat.toFixed(5)}, ${u.lng.toFixed(5)}</span>`
    : '<b style="font-size: 15px">Sin ubicación</b><span class="ayuda">El GPS anda sin señal de datos</span>';
  return `${cabeza('ficha')}
  <main class="cuerpo">
    <div class="pila"><label class="etiqueta" for="nombre">Nombre de la obra</label>
      <input class="campo" id="nombre" data-c="nombre" value="${esc(o.nombre)}" placeholder="Ej. Refacción vivienda" autocomplete="off"></div>
    <div class="grilla-2">
      <div class="pila"><label class="etiqueta" for="cliente">Dueño / cliente</label>
        <input class="campo" id="cliente" data-c="cliente" value="${esc(o.cliente)}" placeholder="Nombre" autocomplete="off"></div>
      <div class="pila"><label class="etiqueta" for="tel">Teléfono</label>
        <input class="campo" id="tel" type="tel" data-c="telefono" value="${esc(o.telefono)}" placeholder="09xx xxx xxx"></div>
    </div>
    <div class="pila"><span class="etiqueta">Ubicación</span>
      <div class="tarjeta" style="flex-direction: row; align-items: center; padding: 12px 14px">
        <div style="width: 40px; height: 40px; border-radius: 10px; background: var(--contra-suave); color: var(--contra); display: flex; align-items: center; justify-content: center">${I.pin}</div>
        <div class="pila" style="gap: 2px; flex: 1; min-width: 0">${ubic}</div>
        <button class="boton chico" data-a="ubicar" id="botonUbicar">${u ? 'Volver a tomar' : 'Tomar'}</button>
      </div></div>
    <fieldset class="pila" style="border: 0; margin: 0; padding: 0"><legend class="etiqueta" style="margin-bottom: 8px">Qué encargo es</legend>
      <div class="envolver">${M.ENCARGOS.map(([k, t]) => `<button class="chip" data-a="encargo" data-v="${k}" aria-pressed="${o.encargo === k}">${t}</button>`).join('')}</div>
    </fieldset>
    <fieldset class="pila" style="border: 0; margin: 0; padding: 0"><legend class="etiqueta" style="margin-bottom: 8px">Quién está en la visita</legend>
      <div class="grilla-3">${M.PERSONAS.filter(([k]) => k !== 'yo').map(([k, t]) => {
        const si = o.presentes.includes(k);
        return `<button class="persona" data-a="presente" data-v="${k}" data-quien="${k}" aria-pressed="${si}">${t}<small>${si ? 'presente' : 'no está'}</small></button>`;
      }).join('')}</div>
      <p class="ayuda">Cada voz queda marcada en la grabación con su color.</p>
    </fieldset>
    <fieldset class="pila" style="border: 0; margin: 0; padding: 0"><legend class="etiqueta" style="margin-bottom: 8px">Ambientes a relevar</legend>
      <div class="envolver">${o.ambientes.map((a) => `<span class="chip" style="padding-right: 4px">${esc(a.nombre)}<button data-a="quitarAmb" data-id="${a.id}" aria-label="Quitar ${esc(a.nombre)}" style="width: 32px; height: 32px; border: 0; border-radius: 16px; background: var(--suave); display: flex; align-items: center; justify-content: center; padding: 0">${I.equis}</button></span>`).join('')}</div>
      <div class="fila"><input class="campo" id="nuevoAmb" placeholder="Agregar ambiente (ej. Dormitorio 2)" autocomplete="off" enterkeyhint="done">
        <button class="boton chico oscuro" data-a="agregarAmb" aria-label="Agregar ambiente" style="width: 50px; height: 50px; padding: 0">${I.mas}</button></div>
    </fieldset>
    <a class="boton primario" href="${ruta('fotos', E.ambId)}" style="margin-top: 8px">${I.camara}Empezar el recorrido</a>
  </main>`;
}

// --- 3 · Fotos -------------------------------------------------------------------------

function vistaFotos() {
  const o = E.obra, a = amb();
  const fotos = a ? M.fotosDe(o, a.id) : [];
  const ult = fotos.at(-1);
  const notas = fotos.filter((f) => f.nota_mime).length;
  return `<div class="camara">
    <header class="cabeza">
      <div class="cabeza-fila" style="justify-content: space-between">
        <a class="volver" href="${ruta('ficha')}" aria-label="Volver a la ficha">${I.atras}</a>
        <div class="pila" style="align-items: center; gap: 2px; min-width: 0">
          <b style="font-family: var(--display); font-size: 17px">${esc(a?.nombre || 'Sin ambiente')}</b>
          <span style="font-size: 12px; color: #C9C1B2">${fotos.length} foto${fotos.length === 1 ? '' : 's'} · ${notas} nota${notas === 1 ? '' : 's'} de voz</span>
        </div>
        <div class="fila" style="gap: 6px">
          ${a?.medir ? `<a class="pildora" href="${ruta('medidas', a.id)}">Medir</a>` : ''}
          ${grabador.estado !== 'quieto' ? relojHtml().replace('class="reloj', 'class="pildora reloj') : `<a class="pildora" href="${ruta('voz')}">Voz</a>`}
        </div>
      </div>
      <nav class="chips-scroll" aria-label="Ambientes">
        ${o.ambientes.map((x) => {
          const n = M.fotosDe(o, x.id).length;
          return `<button class="chip${n ? '' : ' falta'}" data-a="ambFoto" data-id="${x.id}" aria-pressed="${x.id === E.ambId}">${esc(x.nombre)} <span style="opacity: 0.75">${n}</span></button>`;
        }).join('')}
      </nav>
    </header>
    <div class="visor" id="visor">
      <video id="video" autoplay playsinline muted></video>
      <div class="tercios"></div>
      <div class="nivel" id="nivel" hidden></div>
      <div class="flash" id="flash"></div>
      <div class="mensaje" id="mensajeCamara" hidden></div>
    </div>
    <div class="pila" style="gap: 14px; padding: 14px 16px calc(20px + env(safe-area-inset-bottom))">
      <div class="tipos" role="group" aria-label="Tipo de foto">
        ${M.TIPOS_FOTO.map(([k, t]) => `<button data-a="tipoFoto" data-v="${k}" aria-pressed="${E.tipoFoto === k}">${t}</button>`).join('')}
      </div>
      <div class="fila" style="justify-content: space-between">
        <button class="miniatura" data-a="abrirGaleria" aria-label="Ver las fotos de ${esc(a?.nombre || '')}" ${ult ? `data-blob="${ult.id}"` : ''}>${ult ? '' : I.imagen}${fotos.length ? `<b>${fotos.length}</b>` : ''}</button>
        <button class="disparo" data-a="disparar" aria-label="Sacar foto"><span></span></button>
        <button class="microfono" id="microfono" aria-label="Mantené apretado para dictar una nota sobre la última foto">${I.mic}</button>
      </div>
      <p class="ayuda" style="text-align: center; color: #C9C1B2">Mantené apretado el micrófono para dictar una nota sobre la última foto</p>
      <div class="grilla-2">
        <label class="boton chico" style="border-color: #45433D; color: #E8E2D6">${I.camara}Cámara del teléfono<input type="file" accept="image/*" capture="environment" data-c="archivoFoto" hidden></label>
        <label class="boton chico" style="border-color: #45433D; color: #E8E2D6">${I.imagen}Desde la galería<input type="file" accept="image/*" multiple data-c="archivoFoto" hidden></label>
      </div>
    </div>
  </div>`;
}

function apagarCamara() {
  cerrarStream(camara);
  camara = null;
  window.removeEventListener('deviceorientation', nivelar);
}

function nivelar(e) {
  const el = document.getElementById('nivel');
  if (!el || e.gamma == null) return;
  const portrait = window.innerHeight >= window.innerWidth;
  const g = portrait ? e.gamma : e.beta;
  el.hidden = false;
  el.style.transform = `rotate(${-g}deg)`;
  el.classList.toggle('ok', Math.abs(g) < 1.5);
}

async function prenderCamara() {
  const video = document.getElementById('video');
  const msg = document.getElementById('mensajeCamara');
  if (!video) return;
  try {
    if (!camara || !camara.active) camara = await abrirCamara(video);
    else { video.srcObject = camara; await video.play().catch(() => {}); }
    msg.hidden = true;
    window.addEventListener('deviceorientation', nivelar);
  } catch (e) {
    msg.hidden = false;
    msg.innerHTML = `${I.camara}<span>No se pudo abrir la cámara acá (${esc(e.name === 'NotAllowedError' ? 'falta el permiso' : e.message)}).<br>Usá <b>Cámara del teléfono</b> abajo, anda igual sin señal.</span>`;
  }
}

async function guardarFoto(blob) {
  const o = E.obra;
  const id = M.uuid();
  await db.guardarBlob(id, o.id, blob);
  o.fotos.push({ id, ambiente: E.ambId, tipo: E.tipoFoto, tomada: M.ahoraISO(), mime: blob.type || 'image/jpeg', nota_mime: null, nota_texto: '' });
  E.ultimaFoto = id;
  await guardarYa();
  return id;
}

function microfonoFotos() {
  const boton = document.getElementById('microfono');
  if (!boton) return;
  let nota = null, empezando = null;
  const soltar = async () => {
    boton.classList.remove('grabando');
    if (empezando) await empezando.catch(() => {});
    if (!nota) return;
    const n = nota;
    nota = null;
    const blob = await n.terminar();
    if (!blob) { tostada('Mantené apretado mientras hablás'); return; }
    const foto = E.obra.fotos.find((f) => f.id === E.ultimaFoto);
    if (!foto) return;
    await db.guardarBlob(`nota:${foto.id}`, E.obra.id, blob);
    urls.delete(`nota:${foto.id}`);
    foto.nota_mime = blob.type || 'audio/webm';
    await guardarYa();
    tostada('Nota de voz pegada a la última foto');
    pintar();
  };
  boton.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!E.obra.fotos.some((f) => f.id === E.ultimaFoto)) { tostada('Sacá una foto primero'); return; }
    boton.setPointerCapture?.(e.pointerId);
    boton.classList.add('grabando');
    empezando = empezarNota().then((n) => { nota = n; }).catch((err) => {
      boton.classList.remove('grabando');
      tostada(`No se pudo usar el micrófono: ${err.message}`);
    }).finally(() => { empezando = null; });
  });
  boton.addEventListener('pointerup', soltar);
  boton.addEventListener('pointercancel', soltar);
  boton.addEventListener('contextmenu', (e) => e.preventDefault());
}

function vistaGaleria() {
  const o = E.obra;
  const a = o.ambientes.find((x) => x.id === E.galeria.amb);
  const fotos = M.fotosDe(o, E.galeria.amb);
  const f = fotos.find((x) => x.id === E.galeria.foto);
  const cab = `<header class="cabeza" style="background: var(--noche); border: 0"><div class="cabeza-fila">
      <button class="boton-redondo" data-a="${f ? 'verGaleria' : 'cerrarGaleria'}" aria-label="${f ? 'Volver a las fotos' : 'Cerrar'}">${f ? I.atras : I.equis}</button>
      <h1 style="color: #fff">${esc(a?.nombre || '')} · ${f ? `foto ${fotos.indexOf(f) + 1} de ${fotos.length}` : `${fotos.length} fotos`}</h1></div></header>`;
  if (f) {
    return `<div class="galeria" role="dialog" aria-label="Foto">${cab}<div class="grande">
      <img data-blob="${f.id}" alt="Foto ${fotos.indexOf(f) + 1} de ${esc(a?.nombre || '')}">
      <div class="tipos" role="group" aria-label="Tipo de foto">${M.TIPOS_FOTO.map(([k, t]) => `<button data-a="tipoDeFoto" data-v="${k}" aria-pressed="${f.tipo === k}">${t}</button>`).join('')}</div>
      ${f.nota_mime ? `<audio controls data-blob="nota:${f.id}" style="width: 100%"></audio>` : ''}
      <label class="etiqueta" for="notaFoto" style="color: #C9C1B2">Nota escrita</label>
      <textarea class="campo" id="notaFoto" data-c="notaFoto" placeholder="Qué se ve, qué hay que revisar">${esc(f.nota_texto)}</textarea>
      <button class="boton peligro" data-a="borrarFoto" style="border-color: #F9A77E; color: #F9A77E">Borrar esta foto</button>
    </div></div>`;
  }
  return `<div class="galeria" role="dialog" aria-label="Fotos de ${esc(a?.nombre || '')}">${cab}
    ${fotos.length ? `<div class="grilla">${fotos.map((x, i) => `<figure data-blob="${x.id}"><button data-a="verFoto" data-id="${x.id}" aria-label="Ver foto ${i + 1}"></button><figcaption>${i + 1} · ${M.TIPOS_FOTO.find(([k]) => k === x.tipo)?.[1] || ''}${x.nota_mime ? ' · voz' : ''}</figcaption></figure>`).join('')}</div>`
      : '<p class="ayuda" style="padding: 24px; text-align: center; color: #C9C1B2">Todavía no hay fotos de este ambiente</p>'}
  </div>`;
}

// --- 4 · Medidas -------------------------------------------------------------------------

const ORDEN_MEDIDAS = ['A', 'B', 'C', 'D', 'diagonal', 'alto'];
const NOMBRE_CAMPO = {
  A: 'Pared A · arriba', B: 'Pared B · derecha', C: 'Pared C · abajo', D: 'Pared D · izquierda',
  diagonal: 'Diagonal · de la esquina arriba-izquierda a la de abajo-derecha', alto: 'Alto del techo',
};

const valorCampo = (a, k) => (k === 'diagonal' ? a.diagonal : k === 'alto' ? a.alto : a.paredes[k]);
function ponerCampo(a, k, v) {
  if (k === 'diagonal') a.diagonal = v;
  else if (k === 'alto') a.alto = v;
  else a.paredes[k] = v;
}

function croquis(a) {
  const W = 300, H = 222;
  const w = M.ancho(a) || 4, f = M.fondo(a) || 3;
  const s = Math.min(200 / w, 140 / f);
  const rw = w * s, rh = f * s;
  const x0 = (W - rw) / 2, y0 = 34 + (140 - rh) / 2;
  const P0 = [x0, y0], P1 = [x0 + rw, y0], P2 = [x0 + rw, y0 + rh], P3 = [x0, y0 + rh];
  const esq = { A: [P0, P1], B: [P1, P2], C: [P2, P3], D: [P3, P0] };
  const ac = getComputedStyle(document.documentElement).getPropertyValue('--acento').trim() || '#C2410C';
  const partes = [];
  // diagonal
  const diagActiva = E.campo === 'diagonal';
  partes.push(`<line x1="${P0[0]}" y1="${P0[1]}" x2="${P2[0]}" y2="${P2[1]}" stroke="${diagActiva ? ac : '#8C8578'}" stroke-width="${diagActiva ? 2.5 : 1.2}" stroke-dasharray="4 4"></line>`);
  const ang = (Math.atan2(rh, rw) * 180) / Math.PI;
  const cx = x0 + rw / 2, cy = y0 + rh / 2;
  const dx = x0 + rw * 0.68 + 6, dy = y0 + rh * 0.68 - 6;
  partes.push(`<text x="${dx}" y="${dy}" font-size="11" font-weight="700" fill="${diagActiva ? ac : '#5E5A52'}" transform="rotate(${ang.toFixed(1)} ${dx} ${dy})" text-anchor="middle">diag. ${a.diagonal != null ? M.fmt(a.diagonal) : '?'}</text>`);
  partes.push(`<line class="toque" x1="${P0[0] + 20}" y1="${P0[1] + 14}" x2="${P2[0] - 20}" y2="${P2[1] - 14}" data-a="campo" data-v="diagonal"><title>Diagonal</title></line>`);
  // paredes
  for (const k of M.PAREDES) {
    const [p, q] = esq[k];
    const activa = E.campo === k;
    partes.push(`<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${activa ? ac : '#1B1A17'}" stroke-width="${activa ? 7 : 5}" stroke-linecap="square"></line>`);
  }
  // aberturas
  for (const ab of a.aberturas) {
    const largo = M.largoPared(a, ab.pared);
    if (ab.desde == null || ab.ancho == null || !largo) continue;
    const [p, q] = esq[ab.pared];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const u = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    const n = [-u[1], u[0]];
    const k = L / largo;
    const ini = [p[0] + u[0] * ab.desde * k, p[1] + u[1] * ab.desde * k];
    const fin = [p[0] + u[0] * (ab.desde + ab.ancho) * k, p[1] + u[1] * (ab.desde + ab.ancho) * k];
    partes.push(`<line x1="${ini[0]}" y1="${ini[1]}" x2="${fin[0]}" y2="${fin[1]}" stroke="#FFFFFF" stroke-width="9"></line>`);
    const r = ab.ancho * k;
    if (ab.tipo === 'puerta') {
      const hoja = [ini[0] + n[0] * r, ini[1] + n[1] * r];
      const cruz = (hoja[0] - ini[0]) * (fin[1] - ini[1]) - (hoja[1] - ini[1]) * (fin[0] - ini[0]);
      partes.push(`<path d="M${ini[0]} ${ini[1]} L${hoja[0]} ${hoja[1]} A${r} ${r} 0 0 ${cruz > 0 ? 1 : 0} ${fin[0]} ${fin[1]}" fill="none" stroke="#1B1A17" stroke-width="1.3"></path>`);
    } else {
      for (const o of [-2.5, 2.5]) partes.push(`<line x1="${ini[0] + n[0] * o}" y1="${ini[1] + n[1] * o}" x2="${fin[0] + n[0] * o}" y2="${fin[1] + n[1] * o}" stroke="#1B1A17" stroke-width="1.5"></line>`);
    }
    const mid = [(ini[0] + fin[0]) / 2 + n[0] * 12, (ini[1] + fin[1]) / 2 + n[1] * 12 + 4];
    partes.push(`<text x="${mid[0]}" y="${mid[1]}" font-size="10" font-weight="700" fill="#5E5A52" text-anchor="middle">${esc(ab.codigo)}</text>`);
  }
  // rótulos y zonas de toque de las paredes
  const rot = { A: [cx, y0 - 12, 0], B: [x0 + rw + 18, cy, 90], C: [cx, y0 + rh + 22, 0], D: [x0 - 18, cy, -90] };
  for (const k of M.PAREDES) {
    const [p, q] = esq[k];
    const [tx, ty, g] = rot[k];
    const activa = E.campo === k;
    const v = a.paredes[k];
    partes.push(`<text x="${tx}" y="${ty}" font-family="Archivo, sans-serif" font-size="14" font-weight="${activa ? 800 : 700}" fill="${activa ? ac : v == null ? '#8A2E07' : '#1B1A17'}" text-anchor="middle"${g ? ` transform="rotate(${g} ${tx} ${ty})"` : ''}>${k} · ${v != null ? M.fmt(v) : '?'}</text>`);
    partes.push(`<line class="toque" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" data-a="campo" data-v="${k}"><title>Pared ${k}</title></line>`);
  }
  const altoActivo = E.campo === 'alto';
  partes.push(`<rect x="${cx - 40}" y="${cy + 4}" width="80" height="22" rx="6" fill-opacity="0.92" fill="${altoActivo ? '#FBE6DA' : 'transparent'}" data-a="campo" data-v="alto" style="cursor: pointer"></rect>`);
  partes.push(`<text x="${cx}" y="${cy + 19}" font-size="12" font-weight="700" fill="${altoActivo ? ac : '#5E5A52'}" text-anchor="middle" pointer-events="none">alto ${a.alto != null ? M.fmt(a.alto) : '?'}</text>`);
  return `<svg class="croquis" viewBox="0 0 ${W} ${H}" role="img" aria-label="Croquis de ${esc(a.nombre)}: tocá una pared para medirla" font-family="Manrope, sans-serif">${partes.join('')}</svg>`;
}

function escuadraHtml(a) {
  const e = M.escuadra(a);
  const clase = e.estado === 'ok' ? 'bien' : e.estado === 'aviso' ? 'mal' : 'info';
  return `<div class="aviso ${clase}">${e.estado === 'ok' ? I.check : I.aviso}<span>${esc(e.texto)}</span></div>`;
}

function datosMedidas(a) {
  const aMedir = M.ambientesAMedir(E.obra);
  return `<div class="dato blanco"><span>Superficie</span><b>${a.medir && M.superficie(a) ? `${M.fmt(M.superficie(a))} m²` : '—'}</b></div>
    <div class="dato blanco"><span>Medidos</span><b>${aMedir.filter(M.estaMedido).length} de ${aMedir.length}</b></div>`;
}

function chipsMedidas() {
  return E.obra.ambientes.map((x) => {
    if (!x.medir) return `<button class="chip" data-a="ambMed" data-id="${x.id}" aria-pressed="${x.id === E.ambId}" style="opacity: 0.7">${esc(x.nombre)}</button>`;
    const listo = M.faltantes(x).length === 0;
    return `<button class="chip${listo ? ' listo' : ' falta'}" data-a="ambMed" data-id="${x.id}" aria-pressed="${x.id === E.ambId}">${listo ? I.check : ''}${esc(x.nombre)}${listo ? '' : ' · falta'}</button>`;
  }).join('');
}

function formAbertura(a, ab) {
  const prob = M.problemasAbertura(a, ab);
  const campo = (k, t) => `<label>${t}<input class="campo" inputmode="decimal" data-c="ab" data-k="${k}" value="${ab[k] != null ? M.fmt(ab[k]) : ''}" placeholder="m"></label>`;
  const largo = M.largoPared(a, ab.pared);
  const desdeAyuda = { A: 'desde la esquina izquierda', B: 'desde la esquina de arriba', C: 'desde la esquina derecha', D: 'desde la esquina de abajo' }[ab.pared];
  return `<div class="abertura-form">
    <div class="fila" style="justify-content: space-between"><b>${ab.codigo} · ${ab.tipo === 'puerta' ? 'Puerta' : 'Ventana'}</b>
      <button class="boton chico" data-a="cerrarAb">Listo</button></div>
    <div class="pila" style="gap: 6px"><span class="etiqueta">En qué pared</span>
      <div class="segmento">${M.PAREDES.map((k) => `<button data-a="paredAb" data-v="${k}" aria-pressed="${ab.pared === k}">${k}</button>`).join('')}</div></div>
    <div class="mini-campos">
      ${campo('desde', `Distancia ${desdeAyuda}`)}
      ${campo('ancho', 'Ancho del vano')}
      ${campo('alto', 'Alto del vano')}
      ${ab.tipo === 'ventana' ? campo('antepecho', 'Antepecho (piso a ventana)') : ''}
    </div>
    ${largo ? `<p class="ayuda">La pared ${ab.pared} mide ${M.fmt(largo)} m.</p>` : ''}
    <div id="probAb">${prob.length ? `<div class="aviso mal">${I.aviso}<span>${esc(ab.codigo)} ${esc(prob.join(' y '))}.</span></div>` : ''}</div>
    <button class="boton chico peligro" data-a="borrarAb">Borrar ${ab.codigo}</button>
  </div>`;
}

function vistaMedidas() {
  const a = amb();
  if (!a) return `${cabeza('medidas')}<main class="cuerpo"><div class="vacio">Agregá ambientes en la ficha.</div></main>`;
  const cab = `${cabeza('medidas')}<nav class="chips-scroll" aria-label="Ambientes" style="padding: 14px 16px 0">${chipsMedidas()}</nav>`;
  if (!a.medir) {
    return `${cab}<main class="cuerpo">
      <div class="aviso info">${I.aviso}<span><b>${esc(a.nombre)}</b> no se mide en planta. Sirve para las fotos (por ejemplo, la fachada).</span></div>
      <button class="boton" data-a="medirIgual">Medirlo igual</button>
      <div class="pila"><label class="etiqueta" for="notasAmb">Notas</label><textarea class="campo" id="notasAmb" data-c="notasAmb">${esc(a.notas)}</textarea></div>
    </main>`;
  }
  const ab = a.aberturas.find((x) => x.id === E.abertura);
  const v = valorCampo(a, E.campo);
  return `${cab}<main class="cuerpo" style="gap: 18px">
    <div class="tarjeta" style="padding: 12px; gap: 6px">
      <div class="fila" style="justify-content: space-between"><h2 class="sub">Croquis de ${esc(a.nombre)}</h2><span class="ayuda">rectángulo</span></div>
      <div id="croquis">${croquis(a)}</div>
      <p class="ayuda">Tocá una pared, la diagonal o el alto para cargar su medida</p>
    </div>
    <div class="pila">
      <label class="etiqueta" for="medida">${NOMBRE_CAMPO[E.campo]}</label>
      <div class="fila">
        <div class="medida" style="flex: 1" id="cajaMedida"><input id="medida" inputmode="decimal" enterkeyhint="next" data-c="medida" value="${v != null ? M.fmt(v) : ''}" placeholder="0,00" autocomplete="off"><span>m</span></div>
        <button class="boton oscuro" data-a="siguienteMedida" style="min-height: 64px">Siguiente</button>
      </div>
      <p class="ayuda" id="ayudaMedida">Escribí 4,18 o en centímetros: 418</p>
      <div id="escuadra">${escuadraHtml(a)}</div>
    </div>
    <section class="pila">
      <h2 class="etiqueta">Puertas y ventanas</h2>
      ${ab ? formAbertura(a, ab) : ''}
      <div class="lista">
        ${a.aberturas.filter((x) => x.id !== E.abertura).map((x) => `<button data-a="editarAb" data-id="${x.id}" style="justify-content: space-between">
          <b>${esc(x.codigo)} · ${x.tipo === 'puerta' ? 'Puerta' : 'Ventana'}</b>
          <span class="ayuda">pared ${x.pared} · ${M.fmt(x.ancho)} × ${M.fmt(x.alto)}${x.tipo === 'ventana' && x.antepecho != null ? ` · antep. ${M.fmt(x.antepecho)}` : ''}</span></button>`).join('')}
        <div style="gap: 8px; padding: 8px">
          <button class="boton chico" data-a="nuevaAb" data-v="puerta" style="flex: 1">${I.mas}Puerta</button>
          <button class="boton chico" data-a="nuevaAb" data-v="ventana" style="flex: 1">${I.mas}Ventana</button>
        </div>
      </div>
    </section>
    <div class="grilla-2" id="datosMed">${datosMedidas(a)}</div>
    <div class="pila"><label class="etiqueta" for="notasAmb">Notas de ${esc(a.nombre)}</label>
      <textarea class="campo" id="notasAmb" data-c="notasAmb" placeholder="Material del piso, humedad, fisuras, instalaciones…">${esc(a.notas)}</textarea></div>
    <a class="boton primario" href="${ruta('plano')}">${I.plano}Ver plano preliminar</a>
  </main>`;
}

function repintarMedidas() {
  const a = amb();
  if (!a) return;
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('croquis', croquis(a));
  set('escuadra', escuadraHtml(a));
  set('datosMed', datosMedidas(a));
  const nav = app.querySelector('nav.chips-scroll');
  if (nav) nav.innerHTML = chipsMedidas();
  const ab = a.aberturas.find((x) => x.id === E.abertura);
  if (ab) {
    const prob = M.problemasAbertura(a, ab);
    set('probAb', prob.length ? `<div class="aviso mal">${I.aviso}<span>${esc(ab.codigo)} ${esc(prob.join(' y '))}.</span></div>` : '');
  }
}

// --- 5 · Plano ----------------------------------------------------------------------------

let arrastre = null;

function vistaPlano() {
  const o = E.obra;
  const antes = JSON.stringify(o.ambientes.map((a) => a.plano));
  P.acomodar(o);
  if (JSON.stringify(o.ambientes.map((a) => a.plano)) !== antes) guardarLuego();
  const aMedir = M.ambientesAMedir(o);
  const faltan = aMedir.filter((a) => !M.estaMedido(a));
  const sel = o.ambientes.find((a) => a.id === E.sel);
  return `${cabeza('plano')}<main class="cuerpo" style="gap: 14px">
    <div class="fila" style="justify-content: space-between"><h2 class="sub">Plano preliminar</h2><span class="estado" style="border: 1px solid var(--tinta)">Borrador</span></div>
    <div class="lienzo" id="lienzo">${P.svgPlano(o, { seleccionado: E.sel })}</div>
    ${sel ? `<div class="fila">
        <button class="boton chico" data-a="girar" style="flex: 1">${I.girar}Girar ${esc(sel.nombre)}</button>
        <a class="boton chico" href="${ruta('medidas', sel.id)}" style="flex: 1">Medir</a>
        <button class="boton chico" data-a="soltarSel" aria-label="Dejar de mover" style="width: 44px; padding: 0">${I.equis}</button>
      </div>` : '<p class="ayuda">Arrastrá un ambiente para pegarlo a otro: se acomoda solo al tocar el borde. Tocalo para girarlo.</p>'}
    <div class="leyenda">
      <span class="fila" style="gap: 6px"><span style="width: 14px; height: 10px; border: 1.5px dashed var(--acento)"></span>Falta medir${faltan.length ? `: ${esc(faltan.map((a) => a.nombre).join(', '))}` : ''}</span>
      <span>Paredes sin espesor (cara interior medida)</span>
    </div>
    <div class="grilla-2">
      <div class="dato blanco"><span>Superficie medida</span><b>${M.fmt(M.totalSuperficie(o))} m²</b></div>
      <div class="dato blanco"><span>Ambientes</span><b>${aMedir.length - faltan.length} de ${aMedir.length}</b></div>
    </div>
    <div class="grilla-2">
      <button class="boton chico" data-a="reacomodar">Acomodar de nuevo</button>
      <button class="boton chico" data-a="bajarDxf">${I.bajar}Bajar DXF</button>
    </div>
  </main>`;
}

function enganchePlano() {
  const lienzo = document.getElementById('lienzo');
  if (!lienzo) return;
  const coords = (e, vb) => {
    const r = lienzo.getBoundingClientRect();
    const s = Math.min(r.width / vb[2], r.height / vb[3]);
    const ox = (r.width - vb[2] * s) / 2, oy = (r.height - vb[3] * s) / 2;
    return [vb[0] + (e.clientX - r.left - ox) / s, vb[1] + (e.clientY - r.top - oy) / s];
  };
  const vbActual = () => lienzo.querySelector('svg').getAttribute('viewBox').split(' ').map(Number);
  lienzo.onpointerdown = (e) => {
    const g = e.target.closest('[data-amb]');
    if (!g) { if (E.sel) { E.sel = null; pintar(); } return; }
    const a = E.obra.ambientes.find((x) => x.id === g.dataset.amb);
    const vb = vbActual();
    arrastre = { a, vb, inicio: coords(e, vb), desde: { ...a.plano }, movio: false };
    lienzo.setPointerCapture(e.pointerId);
  };
  lienzo.onpointermove = (e) => {
    if (!arrastre) return;
    const [x, y] = coords(e, arrastre.vb);
    const dx = x - arrastre.inicio[0], dy = y - arrastre.inicio[1];
    if (!arrastre.movio && Math.hypot(dx, dy) < 0.15) return;
    arrastre.movio = true;
    arrastre.a.plano.x = Math.round((arrastre.desde.x + dx) * 100) / 100;
    arrastre.a.plano.y = Math.round((arrastre.desde.y + dy) * 100) / 100;
    const svgActual = lienzo.querySelector('svg');
    svgActual.outerHTML = P.svgPlano(E.obra, { seleccionado: arrastre.a.id }).replace(/viewBox="[^"]*"/, `viewBox="${arrastre.vb.join(' ')}"`);
  };
  const fin = () => {
    if (!arrastre) return;
    const { a, movio } = arrastre;
    arrastre = null;
    if (movio) { P.iman(E.obra, a); guardarLuego(); }
    E.sel = a.id;
    pintar();
  };
  lienzo.onpointerup = fin;
  lienzo.onpointercancel = fin;
}

// --- 6 · Voz -------------------------------------------------------------------------------

function marcaHtml(m, editable = true) {
  const tipo = M.TIPOS_MARCA.find(([k]) => k === m.tipo)?.[1] || m.tipo;
  const a = E.obra.ambientes.find((x) => x.id === m.ambiente);
  return `<article class="marca ${m.quien}">
    <span class="quien">${M.quienDice(m.quien)} · ${M.mmss(m.t)}${a ? ` · ${esc(a.nombre)}` : ''}</span>
    <div class="globo">
      ${editable ? `<input data-c="textoMarca" data-id="${m.id}" value="${esc(m.texto)}" placeholder="Anotá en pocas palabras (opcional)" aria-label="Texto de la marca">` : `<span style="flex: 1">${esc(m.texto || 'Sin texto: está en la grabación')}</span>`}
      ${m.foto ? `<div class="foto-chica" data-blob="${m.foto}" role="img" aria-label="Foto adjunta"></div>` : ''}
    </div>
    <span class="sello ${m.tipo}">${tipo.toUpperCase()}</span>
  </article>`;
}

function vistaVoz() {
  const o = E.obra;
  const aca = grabandoAca();
  const otra = grabador.estado !== 'quieto' && !aca;
  const anteriores = o.grabaciones.filter((g) => !g.activa);
  const listaAnteriores = anteriores.length ? `<section class="pila"><h2 class="etiqueta">Charlas grabadas</h2><div class="lista">
      ${anteriores.map((g, i) => `<div style="flex-direction: column; align-items: stretch; gap: 8px">
        <div class="fila" style="justify-content: space-between"><b>Charla ${i + 1} · ${M.mmss(g.duracion)}</b><span class="ayuda">${g.marcas.length} marca${g.marcas.length === 1 ? '' : 's'}${g.recuperada ? ' · se cortó' : ''}</span></div>
        <div id="audio-${g.id}"><button class="boton chico" data-a="escuchar" data-id="${g.id}">${I.play}Escuchar</button></div>
      </div>`).join('')}
    </div></section>` : '';
  if (!aca) {
    return `${cabeza('voz')}<main class="cuerpo">
      ${otra ? `<div class="aviso mal">${I.aviso}<span>Estás grabando en otra obra (${esc(grabador.obra.nombre || 'sin nombre')}). Terminá esa grabación primero.</span></div>` : ''}
      <div class="pila" style="align-items: center; text-align: center; gap: 6px; padding: 12px 0">
        <button class="grabar-grande" data-a="grabar" aria-label="Empezar a grabar la charla"${otra ? ' disabled' : ''}>${I.micGrande}</button>
        <b style="font-family: var(--display); font-size: 20px">Grabar la charla</b>
        <p class="ayuda" style="max-width: 340px">Graba en el celular, sin señal. Mientras hablan, tocá <b>Pedido</b>, <b>Duda</b> o <b>Pendiente</b> para marcar el momento. La transcripción completa se hace en la PC del estudio.</p>
      </div>
      <div class="aviso info">${I.aviso}<span>Avisales que vas a grabar. La pantalla queda prendida mientras grabás: dejá el celular a la vista y cerca de quien habla.</span></div>
      ${listaAnteriores}
      ${o.grabaciones.some((g) => g.marcas.length) ? `<section class="pila" style="gap: 14px"><h2 class="etiqueta">Marcas</h2>${o.grabaciones.flatMap((g) => g.marcas).slice().reverse().map((m) => marcaHtml(m)).join('')}</section>` : ''}
    </main>`;
  }
  const g = grabador.g;
  const opciones = [...o.presentes.filter((k) => k !== 'yo'), 'yo'];
  const quien = grabador.hablante();
  return `${cabeza('voz')}<main class="cuerpo" style="gap: 14px">
    ${g.marcas.length ? g.marcas.slice().reverse().map((m) => marcaHtml(m)).join('')
      : '<div class="vacio">Grabando. Cuando digan algo importante, tocá <b>Pedido</b>, <b>Duda</b> o <b>Pendiente</b>.<br>Cambiá <b>Quién habla</b> cuando cambie la voz.</div>'}
  </main>
  <footer class="pie">
    <div class="pila" style="gap: 6px"><span class="etiqueta">Quién habla</span>
      <div class="grilla-3" role="group" aria-label="Quién habla" style="grid-template-columns: repeat(${opciones.length}, minmax(0, 1fr))">
        ${opciones.map((k) => `<button class="persona quien-${k}" style="min-height: 44px" data-a="hablante" data-v="${k}" data-quien="${k}" aria-pressed="${quien === k}">${M.quienDice(k)}</button>`).join('')}
      </div></div>
    <div class="marcadores">
      <button class="m-pedido" data-a="marcar" data-v="pedido">Pedido</button>
      <button class="m-duda" data-a="marcar" data-v="duda">Duda</button>
      <button class="m-pendiente" data-a="marcar" data-v="pendiente">Pendiente</button>
      <button class="redondo" data-a="${grabador.estado === 'pausa' ? 'seguir' : 'pausar'}" aria-label="${grabador.estado === 'pausa' ? 'Seguir grabando' : 'Pausar'}">${grabador.estado === 'pausa' ? I.play : I.pausa}</button>
    </div>
    <button class="boton chico" data-a="terminarGrab">Terminar la grabación</button>
  </footer>`;
}

// --- 7 · Resumen -----------------------------------------------------------------------------

function textoPendiente(p) {
  if (p.texto) return p.texto;
  const m = M.todasLasMarcas(E.obra).find((x) => x.id === p.origen);
  if (m?.texto) return m.texto;
  return m ? `Pendiente marcado en el minuto ${M.mmss(m.t)}` : 'Pendiente';
}

function vistaResumen() {
  const o = E.obra;
  const avisos = M.avisosAntesDeIrte(o);
  const marcas = M.todasLasMarcas(o);
  const bloque = (tipo, titulo) => {
    const ms = marcas.filter((m) => m.tipo === tipo);
    if (!ms.length) return '';
    return `<section class="pila"><h2 class="sub">${titulo}</h2><div class="pila" style="gap: 14px">${ms.map((m) => marcaHtml(m)).join('')}</div></section>`;
  };
  return `${cabeza('resumen')}<main class="cuerpo">
    ${avisos.length
      ? `<div class="aviso mal">${I.aviso}<span><b>Antes de irte:</b> ${esc(avisos.join(' · '))}.</span></div>`
      : `<div class="aviso bien">${I.check}<span>Está todo relevado: fotos y medidas de cada ambiente.</span></div>`}
    <a class="tarjeta" href="${ruta('plano')}" style="flex-direction: row; align-items: center; padding: 12px 14px">
      <div style="width: 64px; height: 64px; border-radius: 10px; background: var(--papel); overflow: hidden; flex-shrink: 0">${P.svgPlano(P.acomodar(JSON.parse(JSON.stringify(o))))}</div>
      <div class="pila" style="gap: 2px; flex: 1"><b style="font-family: var(--display); font-size: 17px">Plano preliminar</b>
        <span class="ayuda">${M.ambientesAMedir(o).filter(M.estaMedido).length} de ${M.ambientesAMedir(o).length} ambientes · ${M.fmt(M.totalSuperficie(o))} m² medidos</span></div>
      ${I.sig}
    </a>
    ${bloque('pedido', 'Lo que pidieron')}
    ${bloque('duda', 'Dudas a resolver')}
    <section class="pila"><h2 class="sub">Pendientes</h2>
      <div class="lista">
        ${o.pendientes.map((p) => `<label class="check${p.hecho ? ' hecho' : ''}"><input type="checkbox" data-c="pendHecho" data-id="${p.id}"${p.hecho ? ' checked' : ''}><span>${esc(textoPendiente(p))}</span></label>`).join('')}
        <div style="padding: 8px"><input class="campo" id="nuevoPend" placeholder="Agregar pendiente" enterkeyhint="done" style="height: 44px"><button class="boton chico oscuro" data-a="agregarPend" aria-label="Agregar pendiente" style="width: 44px; padding: 0">${I.mas}</button></div>
      </div>
    </section>
    <section class="pila"><h2 class="sub">Fotos por ambiente</h2>
      <div class="grilla-3">${o.ambientes.map((a) => {
        const fotos = M.fotosDe(o, a.id);
        return `<a class="amb-foto${fotos.length ? '' : ' vacia'}" href="${ruta('fotos', a.id)}"${fotos.length ? ` data-blob="${fotos[0].id}"` : ''}><b>${esc(a.nombre)}</b><span>${fotos.length ? `${fotos.length} foto${fotos.length === 1 ? '' : 's'}` : 'falta'}</span></a>`;
      }).join('')}</div>
    </section>
    <section class="pila" style="gap: 10px">
      <button class="boton primario" data-a="mandar"${E.exportando ? ' disabled' : ''}>${I.enviar}${E.exportando ? 'Armando el paquete…' : 'Mandar al estudio'}</button>
      <div class="progreso" id="progreso" hidden><i></i></div>
      <p class="ayuda" style="text-align: center">Arma un ZIP con fotos por ambiente, audios, plano DXF y este resumen. Mandalo por WhatsApp, Drive o cable cuando tengas señal.${o.exportada ? ` Último paquete: ${o.exportada.slice(0, 16).replace('T', ' ')}.` : ''}</p>
      <button class="boton" data-a="copiarCliente">${I.copiar}Copiar resumen para el cliente</button>
      <button class="boton chico peligro" data-a="borrarObra" style="margin-top: 14px">Borrar esta obra del celular</button>
    </section>
  </main>`;
}

// --- Después de pintar -------------------------------------------------------------------------

const despues = {
  fotos: async () => { await prenderCamara(); microfonoFotos(); },
  plano: () => enganchePlano(),
};

// --- Acciones (clics) ------------------------------------------------------------------------

const acciones = {
  async nuevaObra() {
    if (grabador.estado !== 'quieto') { tostada('Terminá la grabación en curso primero'); return; }
    const o = M.nuevaObra();
    await db.guardarObra(o);
    db.pedirPersistencia();
    location.hash = `#/o/${o.id}/ficha`;
    setTimeout(() => document.getElementById('nombre')?.focus(), 100);
  },
  async instalar() {
    const p = E.instalar;
    E.instalar = null;
    await p?.prompt();
    pintar();
  },
  encargo(el) { E.obra.encargo = el.dataset.v; guardarLuego(); pintar(); },
  presente(el) {
    const k = el.dataset.v, l = E.obra.presentes;
    E.obra.presentes = l.includes(k) ? l.filter((x) => x !== k) : [...l, k];
    guardarLuego();
    pintar();
  },
  ubicar(el) {
    if (!navigator.geolocation) { tostada('Este celular no da ubicación'); return; }
    el.disabled = true;
    el.textContent = 'Buscando…';
    navigator.geolocation.getCurrentPosition((p) => {
      E.obra.ubicacion = { lat: p.coords.latitude, lng: p.coords.longitude, precision_m: p.coords.accuracy, tomada: M.ahoraISO() };
      guardarLuego();
      pintar();
    }, (err) => {
      tostada(err.code === 1 ? 'Falta el permiso de ubicación' : 'No se pudo tomar la ubicación. Probá afuera, con cielo abierto');
      pintar();
    }, { enableHighAccuracy: true, timeout: 45000, maximumAge: 60000 });
  },
  agregarAmb() {
    const input = document.getElementById('nuevoAmb');
    const nombre = input.value.trim();
    if (!nombre) { input.focus(); return; }
    const medir = !/fachada|frente/i.test(nombre);
    const a = M.nuevoAmbiente(nombre, medir);
    E.obra.ambientes.push(a);
    guardarLuego();
    pintar().then(() => document.getElementById('nuevoAmb')?.focus());
  },
  quitarAmb(el) {
    const a = E.obra.ambientes.find((x) => x.id === el.dataset.id);
    const fotos = M.fotosDe(E.obra, a.id).length;
    const medido = M.PAREDES.some((k) => a.paredes[k] != null);
    if ((fotos || medido) && !confirm(`${a.nombre} tiene ${fotos} foto${fotos === 1 ? '' : 's'}${medido ? ' y medidas' : ''}. ¿Quitarlo igual? Las fotos quedan sin ambiente.`)) return;
    E.obra.ambientes = E.obra.ambientes.filter((x) => x.id !== a.id);
    for (const f of E.obra.fotos) if (f.ambiente === a.id) f.ambiente = null;
    guardarLuego();
    pintar();
  },
  ambFoto(el) { history.replaceState(null, '', ruta('fotos', el.dataset.id)); E.ambId = el.dataset.id; pintar(); },
  tipoFoto(el) { E.tipoFoto = el.dataset.v; for (const b of app.querySelectorAll('[data-a="tipoFoto"]')) b.setAttribute('aria-pressed', b === el); },
  async disparar(el) {
    if (!camara) { tostada('La cámara no está abierta: usá Cámara del teléfono'); return; }
    el.disabled = true;
    const flash = document.getElementById('flash');
    try {
      flash?.classList.add('on');
      setTimeout(() => flash?.classList.remove('on'), 60);
      const blob = await sacarFoto(camara, document.getElementById('video'));
      await guardarFoto(blob);
      navigator.vibrate?.(30);
      await pintar();
    } catch (e) {
      tostada(`No salió la foto: ${e.message}`);
    } finally {
      el.disabled = false;
    }
  },
  abrirGaleria() { E.galeria = { amb: E.ambId, foto: null }; pintar(); },
  cerrarGaleria() { E.galeria = null; pintar(); },
  verGaleria() { E.galeria.foto = null; pintar(); },
  verFoto(el) { E.galeria.foto = el.dataset.id; pintar(); },
  tipoDeFoto(el) {
    const f = E.obra.fotos.find((x) => x.id === E.galeria.foto);
    f.tipo = el.dataset.v;
    guardarLuego();
    pintar();
  },
  async borrarFoto() {
    if (!confirm('¿Borrar esta foto del celular?')) return;
    const id = E.galeria.foto;
    E.obra.fotos = E.obra.fotos.filter((f) => f.id !== id);
    for (const g of E.obra.grabaciones) for (const m of g.marcas) if (m.foto === id) m.foto = null;
    await db.borrarBlob(id);
    await db.borrarBlob(`nota:${id}`);
    if (E.ultimaFoto === id) E.ultimaFoto = E.obra.fotos.at(-1)?.id || null;
    E.galeria.foto = null;
    await guardarYa();
    pintar();
  },
  ambMed(el) {
    history.replaceState(null, '', ruta('medidas', el.dataset.id));
    E.ambId = el.dataset.id;
    E.abertura = null;
    const a = amb();
    E.campo = ORDEN_MEDIDAS.find((k) => valorCampo(a, k) == null) || 'A';
    pintar();
  },
  medirIgual() { amb().medir = true; guardarLuego(); pintar(); },
  campo(el) {
    E.campo = el.dataset.v;
    pintar().then(() => { const i = document.getElementById('medida'); i?.focus(); i?.select(); });
  },
  siguienteMedida() {
    const a = amb();
    const i = ORDEN_MEDIDAS.indexOf(E.campo);
    const resto = [...ORDEN_MEDIDAS.slice(i + 1), ...ORDEN_MEDIDAS.slice(0, i + 1)];
    E.campo = resto.find((k) => valorCampo(a, k) == null) || ORDEN_MEDIDAS[(i + 1) % ORDEN_MEDIDAS.length];
    if (M.faltantes(a).length === 0 && ORDEN_MEDIDAS.every((k) => valorCampo(a, k) != null)) {
      const sig = M.ambientesAMedir(E.obra).find((x) => M.faltantes(x).length);
      if (sig) tostada(`${a.nombre} completo. Sigue: ${sig.nombre}`);
      else tostada('Todos los ambientes medidos');
    }
    pintar().then(() => { const inp = document.getElementById('medida'); inp?.focus(); inp?.select(); });
  },
  nuevaAb(el) {
    const a = amb();
    const tipo = el.dataset.v;
    const ab = { id: M.uuid(), codigo: M.siguienteCodigo(a, tipo), tipo, pared: E.campo in a.paredes ? E.campo : 'A', desde: null, ancho: tipo === 'puerta' ? 0.8 : 1.2, alto: tipo === 'puerta' ? 2.1 : 1.1, antepecho: tipo === 'ventana' ? 1 : 0 };
    a.aberturas.push(ab);
    E.abertura = ab.id;
    guardarLuego();
    pintar().then(() => app.querySelector('[data-c="ab"][data-k="desde"]')?.focus());
  },
  editarAb(el) { E.abertura = el.dataset.id; pintar(); },
  cerrarAb() { E.abertura = null; pintar(); },
  paredAb(el) {
    const ab = amb().aberturas.find((x) => x.id === E.abertura);
    ab.pared = el.dataset.v;
    guardarLuego();
    pintar();
  },
  borrarAb() {
    const a = amb();
    a.aberturas = a.aberturas.filter((x) => x.id !== E.abertura);
    E.abertura = null;
    guardarLuego();
    pintar();
  },
  girar() {
    const a = E.obra.ambientes.find((x) => x.id === E.sel);
    a.plano.rot = ((a.plano.rot || 0) + 90) % 360;
    P.iman(E.obra, a);
    guardarLuego();
    pintar();
  },
  soltarSel() { E.sel = null; pintar(); },
  reacomodar() {
    if (!confirm('¿Volver a acomodar todos los ambientes en filas? Se pierde cómo los pegaste.')) return;
    for (const a of E.obra.ambientes) a.plano = null;
    E.sel = null;
    guardarLuego();
    pintar();
  },
  bajarDxf() {
    const copia = P.acomodar(JSON.parse(JSON.stringify(E.obra)));
    descargar(new Blob([P.aCp1252(P.dxf(copia))], { type: 'application/dxf' }), nombrePaquete(E.obra).replace(/\.zip$/, '.dxf'));
  },
  async grabar() {
    try {
      const quien = E.obra.presentes.find((k) => k !== 'yo') || 'dueno';
      await grabador.empezar(E.obra, quien);
      await guardarYa();
      pintar();
    } catch (e) {
      const motivo = { NotAllowedError: 'Falta el permiso del micrófono', NotFoundError: 'No se encontró el micrófono', NotReadableError: 'Otra app está usando el micrófono' }[e.name];
      tostada(motivo || `No se pudo grabar: ${e.message}`, 4000);
    }
  },
  pausar() { grabador.pausar(); pintar(); },
  seguir() { grabador.seguir(); pintar(); },
  async terminarGrab() {
    if (!confirm('¿Terminar la grabación? Podés empezar otra después.')) return;
    const o = grabador.obra;
    await grabador.terminar();
    await guardarYa(o);
    tostada('Charla guardada en el celular');
    pintar();
  },
  hablante(el) { grabador.cambiarHablante(el.dataset.v); pintar(); },
  marcar(el) {
    const ult = E.obra.fotos.find((f) => f.id === E.ultimaFoto);
    const reciente = ult && Date.now() - new Date(ult.tomada).getTime() < 120000;
    const m = grabador.marcar({ tipo: el.dataset.v, ambiente: E.ambId, foto: reciente ? ult.id : null });
    if (!m) return;
    if (m.tipo === 'pendiente') E.obra.pendientes.push({ id: M.uuid(), texto: '', hecho: false, origen: m.id });
    navigator.vibrate?.(20);
    guardarLuego();
    tostada(`${M.TIPOS_MARCA.find(([k]) => k === m.tipo)[1]} marcado en ${M.mmss(m.t)}`, 1600);
    pintar();
  },
  async escuchar(el) {
    const trozos = await db.trozos(el.dataset.id);
    const g = E.obra.grabaciones.find((x) => x.id === el.dataset.id);
    if (!trozos.length) { tostada('No quedó audio de esta charla'); return; }
    const u = URL.createObjectURL(new Blob(trozos, { type: g.mime }));
    urls.set(`charla:${g.id}`, u);
    document.getElementById(`audio-${g.id}`).innerHTML = `<audio controls autoplay src="${u}" style="width: 100%"></audio>`;
  },
  agregarPend() {
    const input = document.getElementById('nuevoPend');
    const texto = input.value.trim();
    if (!texto) { input.focus(); return; }
    E.obra.pendientes.push({ id: M.uuid(), texto, hecho: false, origen: null });
    guardarLuego();
    pintar();
  },
  async mandar() {
    if (grabandoAca() && !confirm('Estás grabando: el paquete lleva el audio hasta ahora. ¿Seguir?')) return;
    E.exportando = true;
    await pintar();
    const barra = document.querySelector('#progreso');
    try {
      await guardarYa();
      if (barra) barra.hidden = false;
      const fecha = new Date();
      const { archivos, faltan } = await archivosDelPaquete(E.obra, { leerBlob: db.blob, leerTrozos: db.trozos }, fecha);
      if (barra) barra.firstElementChild.style.width = '60%';
      const partes = await armarZip(archivos);
      const nombre = nombrePaquete(E.obra, fecha);
      const archivo = new File(partes, nombre, { type: 'application/zip' });
      if (barra) barra.firstElementChild.style.width = '100%';
      E.obra.exportada = M.ahoraISO(fecha);
      await guardarYa();
      if (faltan.length) tostada(`Ojo: no se pudieron leer ${faltan.length} archivos`, 4000);
      let compartido = false;
      if (navigator.canShare?.({ files: [archivo] })) {
        try {
          await navigator.share({ files: [archivo], title: nombre });
          compartido = true;
        } catch (e) {
          if (e.name === 'AbortError') compartido = true; // lo cerró: puede bajarlo con el botón otra vez
        }
      }
      if (!compartido) {
        descargar(archivo, nombre);
        tostada(`Paquete guardado en Descargas: ${nombre} (${(archivo.size / 1e6).toFixed(1)} MB)`, 5000);
      }
    } catch (e) {
      tostada(`No se pudo armar el paquete: ${e.message}`, 5000);
    } finally {
      E.exportando = false;
      pintar();
    }
  },
  async copiarCliente() {
    const texto = resumenCliente(E.obra);
    try {
      await navigator.clipboard.writeText(texto);
      tostada('Resumen copiado. Revisalo antes de mandarlo');
    } catch {
      prompt('Copiá el resumen:', texto);
    }
  },
  async borrarObra() {
    const o = E.obra;
    const aviso = o.exportada
      ? '¿Borrar esta obra del celular? Ya la mandaste al estudio.'
      : 'Esta obra NO se mandó al estudio. Si la borrás, se pierden fotos, medidas y audios. ¿Borrar igual?';
    if (!confirm(aviso)) return;
    if (grabandoAca()) await grabador.terminar();
    await db.borrarObra(o.id);
    soltarUrls();
    E.obra = null;
    location.hash = '#/';
  },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = acciones[el.dataset.a];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
});

// --- Campos (escritura) ------------------------------------------------------------------------

app.addEventListener('input', (e) => {
  const el = e.target;
  const c = el.dataset?.c;
  if (!c || !E.obra) return;
  const o = E.obra;
  if (c === 'nombre' || c === 'cliente' || c === 'telefono') {
    o[c] = el.value;
    if (c === 'nombre') { const h = app.querySelector('.cabeza h1'); if (h) h.textContent = el.value || 'Obra nueva'; }
  } else if (c === 'medida') {
    const v = M.leerMedida(el.value);
    const caja = document.getElementById('cajaMedida');
    const ayuda = document.getElementById('ayudaMedida');
    if (Number.isNaN(v) || (v != null && (v <= 0 || v > 60))) {
      caja.style.borderColor = '#9B1C1C';
      ayuda.textContent = 'Eso no parece una medida: usá números, por ejemplo 4,18';
      return;
    }
    caja.style.borderColor = '';
    ayuda.textContent = v != null && !el.value.includes(',') && !el.value.includes('.') && v !== Number(el.value) ? `Lo tomo como ${M.fmt(v)} m` : 'Escribí 4,18 o en centímetros: 418';
    ponerCampo(amb(), E.campo, v);
    repintarMedidas();
  } else if (c === 'ab') {
    const ab = amb().aberturas.find((x) => x.id === E.abertura);
    const v = M.leerMedida(el.value);
    if (Number.isNaN(v)) return;
    ab[el.dataset.k] = v;
    repintarMedidas();
  } else if (c === 'notasAmb') {
    amb().notas = el.value;
  } else if (c === 'notaFoto') {
    o.fotos.find((x) => x.id === E.galeria.foto).nota_texto = el.value;
  } else if (c === 'textoMarca') {
    const m = M.todasLasMarcas(o).find((x) => x.id === el.dataset.id);
    const real = o.grabaciones.find((g) => g.id === m.grabacion.id).marcas.find((x) => x.id === m.id);
    real.texto = el.value;
  } else {
    return;
  }
  guardarLuego();
});

app.addEventListener('change', async (e) => {
  const el = e.target;
  const c = el.dataset?.c;
  if (c === 'pendHecho') {
    const p = E.obra.pendientes.find((x) => x.id === el.dataset.id);
    p.hecho = el.checked;
    el.closest('.check')?.classList.toggle('hecho', el.checked);
    guardarLuego();
  } else if (c === 'archivoFoto') {
    const archivos = [...el.files];
    for (const f of archivos) await guardarFoto(f);
    if (archivos.length) tostada(archivos.length === 1 ? 'Foto guardada' : `${archivos.length} fotos guardadas`);
    pintar();
  }
});

app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const id = e.target.id;
  if (id === 'nuevoAmb') { e.preventDefault(); acciones.agregarAmb(); }
  else if (id === 'nuevoPend') { e.preventDefault(); acciones.agregarPend(); }
  else if (id === 'medida') { e.preventDefault(); acciones.siguienteMedida(); }
});

// --- Arranque ------------------------------------------------------------------------------------

grabador.alGuardar = () => guardarLuego(grabador.obra);
grabador.alCambiar = () => actualizarRelojes();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (E.obra) guardarYa().catch(() => {});
    if (grabador.obra && grabador.obra !== E.obra) guardarYa(grabador.obra).catch(() => {});
  } else if (E.vista === 'fotos' && (!camara || !camara.active)) {
    prenderCamara();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (grabador.estado !== 'quieto') { e.preventDefault(); e.returnValue = ''; }
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  E.instalar = e;
  if (E.vista === 'lista') pintar();
});

window.addEventListener('hashchange', navegar);

// ?sinsw: para probar cambios en la PC sin que el modo sin señal sirva archivos viejos.
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !new URLSearchParams(location.search).has('sinsw')) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Sin modo sin señal:', e));
}

navegar();
