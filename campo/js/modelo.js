// Datos de una obra relevada y cuentas sobre las medidas.
// Sin DOM: lo usan la app y las pruebas de Node.

export const FORMATO = 'fuga-relevamiento/1';
export const VERSION_APP = 'fuga-campo 0.1.0';

export const ENCARGOS = [
  ['refaccion', 'Refacción'],
  ['municipal', 'Municipal con firma'],
  ['regularizacion', 'Regularización'],
  ['ampliacion', 'Ampliación'],
  ['computo', 'Cómputo'],
  ['otro', 'Otro'],
];

export const PERSONAS = [
  ['dueno', 'Dueño'],
  ['contratista', 'Contratista'],
  ['yo', 'Yo'],
  ['otro', 'Otro'],
];

export const TIPOS_FOTO = [
  ['general', 'General'],
  ['detalle', 'Detalle'],
  ['patologia', 'Patología'],
  ['medida', 'Medida'],
];

export const TIPOS_MARCA = [
  ['pedido', 'Pedido'],
  ['duda', 'Duda'],
  ['pendiente', 'Pendiente'],
];

export const PAREDES = ['A', 'B', 'C', 'D'];
export const NOMBRE_PARED = { A: 'arriba', B: 'derecha', C: 'abajo', D: 'izquierda' };

// Diferencia que se acepta entre paredes opuestas o en la diagonal (m).
export const TOLERANCIA = 0.05;

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function ahoraISO(fecha = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -fecha.getTimezoneOffset();
  const s = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}` +
    `T${p(fecha.getHours())}:${p(fecha.getMinutes())}:${p(fecha.getSeconds())}` +
    `${s}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

export function slug(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sin-nombre';
}

export function nuevoAmbiente(nombre, medir = true) {
  return {
    id: uuid(),
    nombre,
    slug: slug(nombre),
    forma: 'rect',
    medir,
    paredes: { A: null, B: null, C: null, D: null },
    diagonal: null,
    alto: null,
    aberturas: [],
    plano: null,
    notas: '',
  };
}

export function nuevaObra() {
  const ambientes = [
    nuevoAmbiente('Fachada', false),
    nuevoAmbiente('Living'),
    nuevoAmbiente('Cocina'),
    nuevoAmbiente('Baño 1'),
    nuevoAmbiente('Dormitorio 1'),
    nuevoAmbiente('Patio'),
  ];
  return {
    formato: FORMATO,
    id: uuid(),
    nombre: '',
    cliente: '',
    telefono: '',
    encargo: 'refaccion',
    ubicacion: null,
    presentes: ['dueno'],
    creada: ahoraISO(),
    actualizada: ahoraISO(),
    exportada: null,
    app: VERSION_APP,
    ambientes,
    fotos: [],
    grabaciones: [],
    pendientes: [],
  };
}

// --- Medidas -------------------------------------------------------------

// "4,18" -> 4.18; "418" -> 4.18 (centímetros si es entero >= 30); "" -> null.
export function leerMedida(texto) {
  const t = String(texto ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  if (t === '') return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  let n = Number(t);
  if (!t.includes('.') && n >= 30) n = n / 100;
  return Math.round(n * 1000) / 1000;
}

export function fmt(n, dec = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toFixed(dec).replace('.', ',');
}

export function ancho(amb) {
  return amb.paredes.A ?? amb.paredes.C ?? null;
}

export function fondo(amb) {
  return amb.paredes.B ?? amb.paredes.D ?? null;
}

export function superficie(amb) {
  const a = ancho(amb), f = fondo(amb);
  return a && f ? Math.round(a * f * 100) / 100 : null;
}

export function diagonalEsperada(amb) {
  const a = ancho(amb), f = fondo(amb);
  return a && f ? Math.hypot(a, f) : null;
}

// Qué le falta a un ambiente para dibujarlo bien.
export function faltantes(amb) {
  if (!amb.medir) return [];
  const f = [];
  if (amb.paredes.A == null && amb.paredes.C == null) f.push('largo (A o C)');
  if (amb.paredes.B == null && amb.paredes.D == null) f.push('ancho (B o D)');
  if (amb.alto == null) f.push('alto');
  return f;
}

export function estaMedido(amb) {
  return amb.medir && ancho(amb) != null && fondo(amb) != null;
}

// Control de escuadra: paredes opuestas parecidas y diagonal que cierra.
export function escuadra(amb) {
  const p = amb.paredes;
  const avisos = [];
  let parejas = 0, maxDif = 0;
  for (const [x, y] of [['A', 'C'], ['B', 'D']]) {
    if (p[x] == null || p[y] == null) continue;
    const d = Math.abs(p[x] - p[y]);
    if (d > TOLERANCIA) avisos.push(`${x} y ${y} difieren ${fmt(d * 100, 0)} cm: volvé a medir una de las dos`);
    else { parejas++; maxDif = Math.max(maxDif, d); }
  }
  const esperada = diagonalEsperada(amb);
  let diagOk = false;
  if (amb.diagonal != null && esperada) {
    const d = Math.abs(amb.diagonal - esperada);
    if (d > TOLERANCIA) avisos.push(`la diagonal debería dar ${fmt(esperada)} y diste ${fmt(amb.diagonal)}: no está a escuadra o hay una medida mal`);
    else diagOk = true;
  }
  if (avisos.length) return { estado: 'aviso', texto: cap(avisos.join('; ')) + '.' };
  const dif = `hasta ${fmt(maxDif * 100, 0)} cm`;
  if (parejas === 2 && diagOk) return { estado: 'ok', texto: `Paredes opuestas parejas (${dif}) y la diagonal cierra: está a escuadra.` };
  if (diagOk) return { estado: 'parcial', texto: 'La diagonal cierra. Medí las cuatro paredes para controlar todo.' };
  if (parejas) return { estado: 'parcial', texto: `Paredes opuestas parejas (${dif}). Medí la diagonal para controlar la escuadra.` };
  return { estado: 'falta', texto: 'Cargá las cuatro paredes y la diagonal para controlar la escuadra.' };
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function largoPared(amb, pared) {
  const p = amb.paredes;
  const opuesta = { A: 'C', B: 'D', C: 'A', D: 'B' }[pared];
  return p[pared] ?? p[opuesta] ?? null;
}

export function siguienteCodigo(amb, tipo) {
  const letra = tipo === 'puerta' ? 'P' : 'V';
  const n = amb.aberturas.filter((a) => a.tipo === tipo).length + 1;
  return `${letra}${n}`;
}

// Abertura que se sale de su pared o se pisa con otra.
export function problemasAbertura(amb, ab) {
  const largo = largoPared(amb, ab.pared);
  const prob = [];
  if (largo != null && ab.desde != null && ab.ancho != null && ab.desde + ab.ancho > largo + 0.001) {
    prob.push(`se sale de la pared ${ab.pared} (${fmt(largo)} m)`);
  }
  for (const otra of amb.aberturas) {
    if (otra.id === ab.id || otra.pared !== ab.pared) continue;
    if (otra.desde == null || otra.ancho == null || ab.desde == null || ab.ancho == null) continue;
    if (ab.desde < otra.desde + otra.ancho && otra.desde < ab.desde + ab.ancho) prob.push(`se pisa con ${otra.codigo}`);
  }
  return prob;
}

// --- Totales de la obra ---------------------------------------------------

export function ambientesAMedir(obra) {
  return obra.ambientes.filter((a) => a.medir);
}

export function fotosDe(obra, ambId) {
  return obra.fotos.filter((f) => f.ambiente === ambId);
}

export function totalSuperficie(obra) {
  let s = 0;
  for (const a of ambientesAMedir(obra)) s += superficie(a) || 0;
  return Math.round(s * 100) / 100;
}

export function todasLasMarcas(obra) {
  const out = [];
  for (const g of obra.grabaciones) {
    for (const m of g.marcas) out.push({ ...m, grabacion: g });
  }
  return out;
}

// Lo que falta antes de irse de la obra.
export function avisosAntesDeIrte(obra) {
  const av = [];
  for (const a of obra.ambientes) {
    const sinFotos = fotosDe(obra, a.id).length === 0;
    const falta = faltantes(a);
    if (sinFotos && falta.length) av.push(`${a.nombre}: sin fotos y falta ${falta.join(', ')}`);
    else if (sinFotos) av.push(`${a.nombre}: sin fotos`);
    else if (falta.length) av.push(`${a.nombre}: falta ${falta.join(', ')}`);
  }
  const pend = obra.pendientes.filter((p) => !p.hecho).length;
  if (pend) av.push(`${pend} pendiente${pend > 1 ? 's' : ''} sin tachar`);
  return av;
}

export function quienDice(quien) {
  return (PERSONAS.find(([k]) => k === quien) || [null, quien])[1];
}

export function mmss(seg) {
  const s = Math.max(0, Math.round(seg || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
