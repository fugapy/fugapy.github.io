// Todo queda en el celular (IndexedDB): obras, fotos y audios.
// Los audios largos se guardan de a trozos mientras se graba, así un corte
// del navegador no se lleva la charla entera.

const NOMBRE = 'fuga-campo';
let abierta = null;

function abrir() {
  if (abierta) return abierta;
  abierta = new Promise((ok, mal) => {
    const pedido = indexedDB.open(NOMBRE, 1);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      db.createObjectStore('obras', { keyPath: 'id' });
      const blobs = db.createObjectStore('blobs', { keyPath: 'id' });
      blobs.createIndex('obra', 'obra');
    };
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => mal(pedido.error);
  });
  return abierta;
}

async function tx(almacen, modo, fn) {
  const db = await abrir();
  return new Promise((ok, mal) => {
    const t = db.transaction(almacen, modo);
    const res = fn(t.objectStore(almacen));
    t.oncomplete = () => ok(res?.result ?? res);
    t.onerror = () => mal(t.error);
    t.onabort = () => mal(t.error || new Error('Se canceló el guardado'));
  });
}

export async function obras() {
  const todas = await tx('obras', 'readonly', (s) => s.getAll());
  return todas.sort((a, b) => (a.actualizada < b.actualizada ? 1 : -1));
}

export const obra = (id) => tx('obras', 'readonly', (s) => s.get(id));
export const guardarObra = (o) => tx('obras', 'readwrite', (s) => s.put(o));

export const guardarBlob = (id, obraId, blob) => tx('blobs', 'readwrite', (s) => s.put({ id, obra: obraId, blob }));

export async function blob(id) {
  const r = await tx('blobs', 'readonly', (s) => s.get(id));
  return r?.blob || null;
}

export const borrarBlob = (id) => tx('blobs', 'readwrite', (s) => s.delete(id));

export const idTrozo = (grabId, n) => `trozo:${grabId}:${String(n).padStart(6, '0')}`;

export async function trozos(grabId) {
  const rango = IDBKeyRange.bound(`trozo:${grabId}:`, `trozo:${grabId}:￿`);
  const r = await tx('blobs', 'readonly', (s) => s.getAll(rango));
  return r.sort((a, b) => (a.id < b.id ? -1 : 1)).map((x) => x.blob);
}

export async function borrarObra(id) {
  const db = await abrir();
  await new Promise((ok, mal) => {
    const t = db.transaction(['obras', 'blobs'], 'readwrite');
    t.objectStore('obras').delete(id);
    const idx = t.objectStore('blobs').index('obra');
    const cur = idx.openKeyCursor(IDBKeyRange.only(id));
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return;
      t.objectStore('blobs').delete(c.primaryKey);
      c.continue();
    };
    t.oncomplete = ok;
    t.onerror = () => mal(t.error);
  });
}

// Pide al navegador que no borre los datos si el celular se queda sin espacio.
export async function pedirPersistencia() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) || false;
  } catch {
    return false;
  }
}

export async function espacio() {
  try {
    const e = await navigator.storage.estimate();
    return { usado: e.usage || 0, total: e.quota || 0 };
  } catch {
    return null;
  }
}
