// ZIP sin compresión (método store), nombres en UTF-8.
// Las fotos y audios ya vienen comprimidos: comprimir de nuevo no gana nada.

const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function fechaDos(d) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, dia };
}

function aBytes(datos) {
  if (datos instanceof Uint8Array) return datos;
  if (typeof datos === 'string') return new TextEncoder().encode(datos);
  if (datos instanceof ArrayBuffer) return new Uint8Array(datos);
  return null; // Blob: se lee de a pedazos para no llenar la memoria del celular
}

async function medirBlob(blob) {
  let crc = 0;
  const lector = blob.stream().getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    crc = crc32(value, crc);
  }
  return { crc, largo: blob.size };
}

// archivos: [{ nombre, datos: Uint8Array | string | Blob, fecha? }]
// Devuelve las partes (Uint8Array o Blob) para armar un Blob.
export async function armarZip(archivos) {
  const enc = new TextEncoder();
  const partes = [];
  const central = [];
  let offset = 0;

  for (const a of archivos) {
    if (!a.nombre || a.nombre.startsWith('/') || a.nombre.includes('..') || a.nombre.includes('\\')) {
      throw new Error(`Nombre inválido en el ZIP: ${a.nombre}`);
    }
    const nombre = enc.encode(a.nombre);
    const bytes = aBytes(a.datos);
    const datos = bytes || a.datos;
    const { crc, largo } = bytes ? { crc: crc32(bytes), largo: bytes.length } : await medirBlob(a.datos);
    const { hora, dia } = fechaDos(a.fecha || new Date());

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8
    local.setUint16(8, 0, true); // store
    local.setUint16(10, hora, true);
    local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, largo, true);
    local.setUint32(22, largo, true);
    local.setUint16(26, nombre.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nombre, datos);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, hora, true);
    cd.setUint16(14, dia, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, largo, true);
    cd.setUint32(24, largo, true);
    cd.setUint16(28, nombre.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nombre);

    offset += 30 + nombre.length + largo;
  }

  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, offset, true);
  return [...partes, ...central, new Uint8Array(fin.buffer)];
}
