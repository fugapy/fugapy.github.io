// Arma el paquete para el estudio (formato fuga-relevamiento/1, ver ../FORMATO.md).
// Sin DOM: recibe una función que devuelve los blobs guardados.

import {
  ENCARGOS, TIPOS_MARCA, fmt, mmss, quienDice, slug, superficie, totalSuperficie,
  fotosDe, avisosAntesDeIrte, todasLasMarcas, ahoraISO, VERSION_APP,
} from './modelo.js';
import { dxf, aCp1252, acomodar } from './plano.js';

export function extension(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'm4a';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png')) return 'png';
  return 'bin';
}

export function nombrePaquete(obra, fecha = new Date()) {
  const d = ahoraISO(fecha).slice(0, 10);
  return `relevamiento_${slug(obra.nombre || 'obra')}_${d}.zip`;
}

// Le pone nombre de archivo a cada foto y audio, y devuelve qué blob va en cada uno.
export function planDeArchivos(obra) {
  const copia = JSON.parse(JSON.stringify(obra));
  const archivos = []; // { nombre, blob: id del blob, partes?: [ids] }
  const porAmbiente = new Map();
  const ambSlug = new Map(copia.ambientes.map((a) => [a.id, a.slug || slug(a.nombre)]));
  const fotos = [...copia.fotos].sort((a, b) => Date.parse(a.tomada) - Date.parse(b.tomada));
  for (const f of fotos) {
    const carpeta = ambSlug.get(f.ambiente) || 'sin-ambiente';
    const n = (porAmbiente.get(carpeta) || 0) + 1;
    porAmbiente.set(carpeta, n);
    f.archivo = `fotos/${carpeta}/${String(n).padStart(2, '0')}_${f.tipo || 'general'}.${extension(f.mime || 'image/jpeg')}`;
    archivos.push({ nombre: f.archivo, blob: f.id });
    if (f.nota_mime) {
      f.nota_audio = `audios/notas/${f.id}.${extension(f.nota_mime)}`;
      archivos.push({ nombre: f.nota_audio, blob: `nota:${f.id}` });
    } else {
      f.nota_audio = null;
    }
  }
  copia.fotos = fotos;
  copia.grabaciones.forEach((g, i) => {
    g.archivo = `audios/charla-${String(i + 1).padStart(2, '0')}.${extension(g.mime)}`;
    archivos.push({ nombre: g.archivo, grabacion: g.id, mime: g.mime });
  });
  return { obra: copia, archivos };
}

// Limpia lo que es interno de la app antes de escribir obra.json.
export function obraParaJson(obra, fecha = new Date()) {
  const o = JSON.parse(JSON.stringify(obra));
  o.exportada = ahoraISO(fecha);
  o.app = VERSION_APP;
  for (const f of o.fotos) { delete f.mime; delete f.nota_mime; }
  // Un pendiente marcado en la charla lleva el texto de su marca (o el minuto).
  const marcas = o.grabaciones.flatMap((g) => g.marcas);
  for (const p of o.pendientes) {
    if (p.texto || !p.origen) continue;
    const m = marcas.find((x) => x.id === p.origen);
    if (m) p.texto = m.texto || `Pendiente marcado en el minuto ${mmss(m.t)}`;
  }
  for (const g of o.grabaciones) { delete g.trozos; delete g.activa; delete g.recuperada; }
  delete o.actualizada;
  return o;
}

export function resumenMd(obra) {
  const L = [];
  const encargo = (ENCARGOS.find(([k]) => k === obra.encargo) || [null, obra.encargo])[1];
  L.push(`# ${obra.nombre || 'Obra sin nombre'}`, '');
  L.push(`- Encargo: ${encargo}`);
  if (obra.cliente) L.push(`- Cliente: ${obra.cliente}${obra.telefono ? ` (${obra.telefono})` : ''}`);
  if (obra.ubicacion) L.push(`- Ubicación: ${obra.ubicacion.lat.toFixed(6)}, ${obra.ubicacion.lng.toFixed(6)} (±${Math.round(obra.ubicacion.precision_m)} m) — https://maps.google.com/?q=${obra.ubicacion.lat},${obra.ubicacion.lng}`);
  L.push(`- Presentes: ${obra.presentes.map(quienDice).join(', ') || '—'}`);
  L.push(`- Fecha: ${obra.creada.slice(0, 10)}`, '');

  const avisos = avisosAntesDeIrte(obra);
  if (avisos.length) {
    L.push('## Quedó sin relevar', '');
    for (const a of avisos) L.push(`- ${a}`);
    L.push('');
  }

  const marcas = todasLasMarcas(obra);
  for (const [tipo, titulo] of TIPOS_MARCA) {
    const deEste = marcas.filter((m) => m.tipo === tipo);
    if (!deEste.length) continue;
    L.push(`## ${titulo}s`, '');
    for (const m of deEste) {
      const amb = obra.ambientes.find((a) => a.id === m.ambiente);
      const lugar = amb ? ` · ${amb.nombre}` : '';
      const texto = m.texto ? m.texto : '(ver transcripción)';
      L.push(`- ${texto} — ${quienDice(m.quien)}${lugar} · min ${mmss(m.t)}`);
    }
    L.push('');
  }

  const lista = obraParaJson(obra).pendientes;
  if (lista.length) {
    L.push('## Lista de pendientes', '');
    for (const p of lista) L.push(`- [${p.hecho ? 'x' : ' '}] ${p.texto}`);
    L.push('');
  }

  L.push('## Medidas', '');
  L.push('| Ambiente | A | B | C | D | Diagonal | Alto | m² | Fotos |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const a of obra.ambientes) {
    const p = a.paredes;
    const fotos = fotosDe(obra, a.id).length;
    if (!a.medir) { L.push(`| ${a.nombre} | — | — | — | — | — | — | — | ${fotos} |`); continue; }
    L.push(`| ${a.nombre} | ${fmt(p.A)} | ${fmt(p.B)} | ${fmt(p.C)} | ${fmt(p.D)} | ${fmt(a.diagonal)} | ${fmt(a.alto)} | ${fmt(superficie(a))} | ${fotos} |`);
  }
  L.push('', `Superficie medida: ${fmt(totalSuperficie(obra))} m² (interior, sin muros).`, '');

  const conAberturas = obra.ambientes.filter((a) => a.aberturas.length);
  if (conAberturas.length) {
    L.push('## Aberturas', '');
    for (const a of conAberturas) {
      for (const ab of a.aberturas) {
        const extra = ab.tipo === 'ventana' && ab.antepecho != null ? ` · antepecho ${fmt(ab.antepecho)}` : '';
        L.push(`- ${a.nombre} ${ab.codigo} (${ab.tipo}): pared ${ab.pared}, a ${fmt(ab.desde)} del inicio, ${fmt(ab.ancho)} × ${fmt(ab.alto)}${extra}`);
      }
    }
    L.push('');
  }
  const notas = obra.ambientes.filter((a) => a.notas);
  if (notas.length) {
    L.push('## Notas', '');
    for (const a of notas) L.push(`- ${a.nombre}: ${a.notas}`);
    L.push('');
  }
  return L.join('\n');
}

// Texto corto para mandarle al cliente por WhatsApp (estilo del estudio: sin ¿ ni punto final).
export function resumenCliente(obra) {
  const marcas = todasLasMarcas(obra).filter((m) => m.tipo === 'pedido' && m.texto);
  const L = [`Hola, te paso lo que relevamos hoy en ${obra.nombre || 'la obra'}`];
  if (marcas.length) {
    L.push('', 'Lo que nos pediste:');
    for (const m of marcas) L.push(`- ${m.texto}`);
  }
  const pend = obra.pendientes.filter((p) => !p.hecho);
  if (pend.length) {
    L.push('', 'Queda pendiente:');
    for (const p of pend) L.push(`- ${p.texto}`);
  }
  L.push('', 'Con esto armamos el plano y te contamos los próximos pasos');
  return L.join('\n');
}

// leerBlob(id) -> Blob | null; leerTrozos(grabId) -> [Blob]
export async function archivosDelPaquete(obraOriginal, { leerBlob, leerTrozos }, fecha = new Date()) {
  const obra = JSON.parse(JSON.stringify(obraOriginal));
  acomodar(obra);
  const { obra: conNombres, archivos } = planDeArchivos(obra);
  const salida = [];
  const faltan = [];
  for (const a of archivos) {
    let blob = null;
    if (a.grabacion) {
      const trozos = await leerTrozos(a.grabacion);
      if (trozos.length) blob = new Blob(trozos, { type: a.mime || trozos[0].type });
    } else {
      blob = await leerBlob(a.blob);
    }
    if (blob) salida.push({ nombre: a.nombre, datos: blob, fecha });
    else faltan.push(a.nombre);
  }
  // No citar en obra.json archivos que no se pudieron leer.
  for (const f of conNombres.fotos) {
    if (faltan.includes(f.nota_audio)) f.nota_audio = null;
  }
  conNombres.fotos = conNombres.fotos.filter((f) => !faltan.includes(f.archivo));
  conNombres.grabaciones = conNombres.grabaciones.filter((g) => !faltan.includes(g.archivo));

  salida.unshift(
    { nombre: 'obra.json', datos: JSON.stringify(obraParaJson(conNombres, fecha), null, 2), fecha },
    { nombre: 'resumen.md', datos: resumenMd(obra), fecha },
    { nombre: 'plano.dxf', datos: aCp1252(dxf(obra)), fecha },
  );
  return { archivos: salida, faltan };
}
