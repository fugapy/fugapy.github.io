// Plano preliminar: geometría de cada ambiente, acomodo automático,
// dibujo SVG para la pantalla y DXF R12 para el estudio.
// Coordenadas en metros, eje Y hacia abajo (como la pantalla).

import { ancho, fondo, superficie, estaMedido, fmt, PAREDES, ambientesAMedir } from './modelo.js';

const SIN_MEDIR = 3; // lado del cuadrado que ocupa un ambiente sin medidas
const SEPARACION = 1; // entre ambientes acomodados solos
const ANCHO_FILA = 12;

export function tamano(amb) {
  if (estaMedido(amb)) return { w: ancho(amb), f: fondo(amb), medido: true };
  return { w: ancho(amb) || SIN_MEDIR, f: fondo(amb) || SIN_MEDIR, medido: false };
}

function rotar([x, y], grados) {
  const r = (grados * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e9) / 1e9;
  const s = Math.round(Math.sin(r) * 1e9) / 1e9;
  return [x * c - y * s, x * s + y * c];
}

// Esquinas y paredes de un ambiente ya ubicado.
export function geometria(amb) {
  const { w, f, medido } = tamano(amb);
  const pos = amb.plano || { x: 0, y: 0, rot: 0 };
  const local = [[0, 0], [w, 0], [w, f], [0, f]];
  const esq = local.map((p) => {
    const [x, y] = rotar(p, pos.rot || 0);
    return [x + pos.x, y + pos.y];
  });
  const paredes = {};
  PAREDES.forEach((k, i) => {
    const a = esq[i], b = esq[(i + 1) % 4];
    const largo = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = [(b[0] - a[0]) / largo, (b[1] - a[1]) / largo];
    paredes[k] = { a, b, largo, u, n: [-u[1], u[0]] }; // n apunta hacia adentro
  });
  const xs = esq.map((p) => p[0]), ys = esq.map((p) => p[1]);
  const caja = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const centro = [(caja.x0 + caja.x1) / 2, (caja.y0 + caja.y1) / 2];
  return { esq, paredes, caja, centro, medido, w, f };
}

const punto = (p, u, d) => [p[0] + u[0] * d, p[1] + u[1] * d];

// Tramos llenos de una pared, dejando huecos en las aberturas.
export function tramosPared(amb, g, k) {
  const pared = g.paredes[k];
  const huecos = amb.aberturas
    .filter((ab) => ab.pared === k && ab.desde != null && ab.ancho != null)
    .map((ab) => [Math.max(0, ab.desde), Math.min(pared.largo, ab.desde + ab.ancho)])
    .filter(([s, e]) => e > s)
    .sort((x, y) => x[0] - y[0]);
  const tramos = [];
  let t = 0;
  for (const [s, e] of huecos) {
    if (s > t) tramos.push([t, s]);
    t = Math.max(t, e);
  }
  if (t < pared.largo) tramos.push([t, pared.largo]);
  return tramos.map(([s, e]) => [punto(pared.a, pared.u, s), punto(pared.a, pared.u, e)]);
}

// Dibujo de cada abertura: puerta = hoja + arco; ventana = doble línea.
export function dibujoAbertura(g, ab) {
  const pared = g.paredes[ab.pared];
  if (!pared || ab.desde == null || ab.ancho == null) return null;
  const s = punto(pared.a, pared.u, ab.desde);
  const e = punto(pared.a, pared.u, ab.desde + ab.ancho);
  if (ab.tipo === 'puerta') {
    const hoja = punto(s, pared.n, ab.ancho);
    return { tipo: 'puerta', bisagra: s, hoja, fin: e, radio: ab.ancho };
  }
  const o = 0.05;
  return {
    tipo: 'ventana',
    lineas: [
      [punto(s, pared.n, o), punto(e, pared.n, o)],
      [punto(s, pared.n, -o), punto(e, pared.n, -o)],
    ],
  };
}

// Ubica los ambientes que todavía no tienen lugar, en filas.
export function acomodar(obra) {
  const amb = ambientesAMedir(obra);
  let x = 0, y = 0, altoFila = 0;
  let maxY = 0;
  for (const a of amb) {
    if (a.plano) {
      const g = geometria(a);
      maxY = Math.max(maxY, g.caja.y1 + SEPARACION);
    }
  }
  y = maxY;
  for (const a of amb) {
    if (a.plano) continue;
    const { w, f } = tamano(a);
    if (x > 0 && x + w > ANCHO_FILA) {
      x = 0;
      y += altoFila + SEPARACION;
      altoFila = 0;
    }
    a.plano = { x, y, rot: 0 };
    x += w + SEPARACION;
    altoFila = Math.max(altoFila, f);
  }
  return obra;
}

// Pega un ambiente a los bordes cercanos de los otros (imán).
export function iman(obra, amb, distancia = 0.3) {
  const g = geometria(amb);
  let dx = null, dy = null;
  for (const otro of ambientesAMedir(obra)) {
    if (otro.id === amb.id || !otro.plano) continue;
    const o = geometria(otro).caja;
    const solapaY = g.caja.y0 < o.y1 + distancia && o.y0 < g.caja.y1 + distancia;
    const solapaX = g.caja.x0 < o.x1 + distancia && o.x0 < g.caja.x1 + distancia;
    if (solapaY) {
      for (const c of [o.x0 - g.caja.x1, o.x1 - g.caja.x0, o.x0 - g.caja.x0, o.x1 - g.caja.x1]) {
        if (Math.abs(c) <= distancia && (dx === null || Math.abs(c) < Math.abs(dx))) dx = c;
      }
    }
    if (solapaX) {
      for (const c of [o.y0 - g.caja.y1, o.y1 - g.caja.y0, o.y0 - g.caja.y0, o.y1 - g.caja.y1]) {
        if (Math.abs(c) <= distancia && (dy === null || Math.abs(c) < Math.abs(dy))) dy = c;
      }
    }
  }
  if (dx) amb.plano.x = redondear(amb.plano.x + dx);
  if (dy) amb.plano.y = redondear(amb.plano.y + dy);
  return amb;
}

const redondear = (n) => Math.round(n * 1000) / 1000;

export function limites(obra) {
  const amb = ambientesAMedir(obra).filter((a) => a.plano);
  if (!amb.length) return { x0: 0, y0: 0, x1: 4, y1: 4 };
  const cajas = amb.map((a) => geometria(a).caja);
  return {
    x0: Math.min(...cajas.map((c) => c.x0)),
    y0: Math.min(...cajas.map((c) => c.y0)),
    x1: Math.max(...cajas.map((c) => c.x1)),
    y1: Math.max(...cajas.map((c) => c.y1)),
  };
}

// --- SVG --------------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n3 = (v) => (Math.round(v * 1000) / 1000).toString();
const pts = (arr) => arr.map((p) => `${n3(p[0])},${n3(p[1])}`).join(' ');

export function svgAmbiente(amb, { seleccionado = false, acento = '#C2410C' } = {}) {
  const g = geometria(amb);
  const partes = [];
  const relleno = g.medido ? '#FFFFFF' : '#FBF3EE';
  partes.push(`<polygon points="${pts(g.esq)}" fill="${relleno}" stroke="none"></polygon>`);
  if (g.medido) {
    for (const k of PAREDES) {
      for (const [a, b] of tramosPared(amb, g, k)) {
        partes.push(`<line x1="${n3(a[0])}" y1="${n3(a[1])}" x2="${n3(b[0])}" y2="${n3(b[1])}" stroke="#1B1A17" stroke-width="0.1" stroke-linecap="square"></line>`);
      }
    }
    for (const ab of amb.aberturas) {
      const d = dibujoAbertura(g, ab);
      if (!d) continue;
      if (d.tipo === 'puerta') {
        const barre = sentidoArco(d.bisagra, d.hoja, d.fin);
        partes.push(`<path d="M${n3(d.bisagra[0])} ${n3(d.bisagra[1])} L${n3(d.hoja[0])} ${n3(d.hoja[1])} A${n3(d.radio)} ${n3(d.radio)} 0 0 ${barre} ${n3(d.fin[0])} ${n3(d.fin[1])}" fill="none" stroke="#1B1A17" stroke-width="0.03"></path>`);
      } else {
        for (const [a, b] of d.lineas) {
          partes.push(`<line x1="${n3(a[0])}" y1="${n3(a[1])}" x2="${n3(b[0])}" y2="${n3(b[1])}" stroke="#1B1A17" stroke-width="0.03"></line>`);
        }
      }
    }
  } else {
    partes.push(`<polygon points="${pts(g.esq)}" fill="none" stroke="${acento}" stroke-width="0.05" stroke-dasharray="0.18 0.14"></polygon>`);
  }
  if (seleccionado) {
    partes.push(`<polygon points="${pts(g.esq)}" fill="none" stroke="#1D4ED8" stroke-width="0.08"></polygon>`);
  }
  const [cx, cy] = g.centro;
  const tam = Math.max(0.24, Math.min(0.4, Math.min(g.caja.x1 - g.caja.x0, g.caja.y1 - g.caja.y0) / 7));
  partes.push(`<text x="${n3(cx)}" y="${n3(cy - tam * 0.2)}" text-anchor="middle" font-size="${n3(tam)}" font-weight="700" fill="#1B1A17" font-family="Archivo, sans-serif">${esc(amb.nombre)}</text>`);
  const sub = g.medido ? `${fmt(superficie(amb))} m²` : 'sin medir';
  partes.push(`<text x="${n3(cx)}" y="${n3(cy + tam * 0.95)}" text-anchor="middle" font-size="${n3(tam * 0.8)}" font-weight="600" fill="${g.medido ? '#5E5A52' : '#8A2E07'}" font-family="Manrope, sans-serif">${esc(sub)}</text>`);
  return `<g data-amb="${esc(amb.id)}" style="cursor: grab">${partes.join('')}</g>`;
}

// En pantalla (Y hacia abajo) el arco va de la hoja al final del vano.
function sentidoArco(c, a, b) {
  const cruz = (a[0] - c[0]) * (b[1] - c[1]) - (a[1] - c[1]) * (b[0] - c[0]);
  return cruz > 0 ? 1 : 0;
}

export function svgPlano(obra, opciones = {}) {
  const amb = ambientesAMedir(obra).filter((a) => a.plano);
  const l = limites(obra);
  const m = 1;
  const vb = [l.x0 - m, l.y0 - m, l.x1 - l.x0 + 2 * m, l.y1 - l.y0 + 2 * m];
  const cuerpo = amb.map((a) => svgAmbiente(a, { seleccionado: a.id === opciones.seleccionado, acento: opciones.acento })).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(n3).join(' ')}" role="img" aria-label="Plano preliminar con ${amb.length} ambientes" style="width:100%;height:100%;touch-action:none">${cuerpo}</svg>`;
}

// --- DXF R12 ------------------------------------------------------------------

export const CAPAS = [
  ['FUGA-RLV-MUROS', 7],
  ['FUGA-RLV-ABERTURAS', 4],
  ['FUGA-RLV-COTAS', 3],
  ['FUGA-RLV-TEXTOS', 2],
  ['FUGA-RLV-FALTA', 1],
];

export function dxf(obra) {
  const out = [];
  const g0 = (c, v) => out.push(String(c), String(v));
  const num = (v) => (Math.round(v * 10000) / 10000).toString();
  const X = (p) => num(p[0]);
  const Y = (p) => num(-p[1]); // DXF: Y hacia arriba

  g0(0, 'SECTION'); g0(2, 'HEADER');
  g0(9, '$ACADVER'); g0(1, 'AC1009');
  g0(9, '$DWGCODEPAGE'); g0(3, 'ANSI_1252');
  g0(9, '$INSUNITS'); g0(70, 6);
  g0(0, 'ENDSEC');

  g0(0, 'SECTION'); g0(2, 'TABLES');
  g0(0, 'TABLE'); g0(2, 'LTYPE'); g0(70, 2);
  g0(0, 'LTYPE'); g0(2, 'CONTINUOUS'); g0(70, 0); g0(3, 'Solid line'); g0(72, 65); g0(73, 0); g0(40, 0);
  g0(0, 'LTYPE'); g0(2, 'DASHED'); g0(70, 0); g0(3, '__ __ __'); g0(72, 65); g0(73, 2); g0(40, 0.3); g0(49, 0.18); g0(49, -0.12);
  g0(0, 'ENDTAB');
  g0(0, 'TABLE'); g0(2, 'LAYER'); g0(70, CAPAS.length);
  for (const [nombre, color] of CAPAS) {
    g0(0, 'LAYER'); g0(2, nombre); g0(70, 0); g0(62, color); g0(6, nombre === 'FUGA-RLV-FALTA' ? 'DASHED' : 'CONTINUOUS');
  }
  g0(0, 'ENDTAB');
  g0(0, 'ENDSEC');

  g0(0, 'SECTION'); g0(2, 'ENTITIES');
  const linea = (capa, a, b) => { g0(0, 'LINE'); g0(8, capa); g0(10, X(a)); g0(20, Y(a)); g0(30, 0); g0(11, X(b)); g0(21, Y(b)); g0(31, 0); };
  const texto = (capa, p, alto, t, giro = 0) => {
    g0(0, 'TEXT'); g0(8, capa); g0(10, X(p)); g0(20, Y(p)); g0(30, 0); g0(40, num(alto)); g0(1, t);
    if (giro) g0(50, num(giro));
    g0(72, 1); g0(73, 2); g0(11, X(p)); g0(21, Y(p)); g0(31, 0);
  };
  const arco = (capa, c, r, a0, a1) => { g0(0, 'ARC'); g0(8, capa); g0(10, X(c)); g0(20, Y(c)); g0(30, 0); g0(40, num(r)); g0(50, num(a0)); g0(51, num(a1)); };

  for (const amb of ambientesAMedir(obra)) {
    if (!amb.plano) continue;
    const g = geometria(amb);
    if (!g.medido) {
      for (let i = 0; i < 4; i++) linea('FUGA-RLV-FALTA', g.esq[i], g.esq[(i + 1) % 4]);
      texto('FUGA-RLV-TEXTOS', g.centro, 0.25, `${amb.nombre} - SIN MEDIR`);
      continue;
    }
    for (const k of PAREDES) {
      for (const [a, b] of tramosPared(amb, g, k)) linea('FUGA-RLV-MUROS', a, b);
      // Cota por fuera de la pared.
      const p = g.paredes[k];
      const fuera = [-p.n[0] * 0.35, -p.n[1] * 0.35];
      const a = [p.a[0] + fuera[0], p.a[1] + fuera[1]];
      const b = [p.b[0] + fuera[0], p.b[1] + fuera[1]];
      if (amb.paredes[k] != null) {
        linea('FUGA-RLV-COTAS', a, b);
        const medio = [(a[0] + b[0]) / 2 - p.n[0] * 0.15, (a[1] + b[1]) / 2 - p.n[1] * 0.15];
        texto('FUGA-RLV-COTAS', medio, 0.15, fmt(amb.paredes[k]), anguloLegible(p.u));
      }
    }
    for (const ab of amb.aberturas) {
      const d = dibujoAbertura(g, ab);
      if (!d) continue;
      if (d.tipo === 'puerta') {
        linea('FUGA-RLV-ABERTURAS', d.bisagra, d.hoja);
        const ang = (q) => (Math.atan2(-(q[1] - d.bisagra[1]), q[0] - d.bisagra[0]) * 180) / Math.PI;
        let a0 = ang(d.hoja), a1 = ang(d.fin);
        if (((a1 - a0 + 360) % 360) > 180) [a0, a1] = [a1, a0];
        arco('FUGA-RLV-ABERTURAS', d.bisagra, d.radio, (a0 + 360) % 360, (a1 + 360) % 360);
      } else {
        for (const [a, b] of d.lineas) linea('FUGA-RLV-ABERTURAS', a, b);
      }
    }
    const [cx, cy] = g.centro;
    texto('FUGA-RLV-TEXTOS', [cx, cy - 0.2], 0.25, amb.nombre);
    texto('FUGA-RLV-TEXTOS', [cx, cy + 0.15], 0.18, `${fmt(superficie(amb))} m²`);
    if (amb.alto != null) texto('FUGA-RLV-TEXTOS', [cx, cy + 0.45], 0.15, `h ${fmt(amb.alto)}`);
  }
  g0(0, 'ENDSEC');
  g0(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

// Ángulo del texto en el DXF para que nunca quede patas arriba.
function anguloLegible(u) {
  let a = (Math.atan2(-u[1], u[0]) * 180) / Math.PI;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
}

// AutoCAD lee el DXF R12 en la página de códigos 1252.
const CP1252 = { 0x20ac: 0x80, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97 };

export function aCp1252(texto) {
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    bytes[i] = CP1252[c] ?? (c < 0x80 || (c >= 0xa0 && c < 0x100) ? c : 63); // '?'
  }
  return bytes;
}
