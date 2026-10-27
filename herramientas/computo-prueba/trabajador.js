// Web Worker de la demo «Cómputo desde plano»: lee el DXF o el DWG y busca los dibujos sin congelar la pantalla.
// Es un Worker de MÓDULO: new Worker('trabajador.js', {type:'module'}). El trabajo está en dwg.js (FugaDwg.procesar); acá solo hay mensajes.
// Entra   {nombre, bytes (ArrayBuffer), unidad?: 'm'|'cm'|'mm', unaLinea?, clave?}   (conviene transferir los bytes: postMessage(msg, [bytes])).
//         clave = nombre|tamaño|fecha del archivo: con la misma clave que la lectura anterior se reusa el doc (FugaDwg.procesar, memoria).
// Sale    {tipo:'progreso', etapa, f}  varias veces (etapas: carga, lectura, aplanado, unidad, muros, dibujos; f de 0 a 1)
//         y al final {tipo:'listo', resultado}  o  {tipo:'error', codigo}  con codigo: binario | vacio | dwg_viejo | dwg_cdn | grande | interno.
// Los UMD (modelo, lector, planos, dibujos, dwg) se cargan con import(): al no haber `module`, se cuelgan de self. LibreDWG (GPL-3.0) se baja de
// jsDelivr, con la versión fija, solo cuando llega un DWG, y queda en caché mientras viva el Worker (si falla la bajada o una lectura, se descarta y se recrea en el próximo DWG).
var CDN_LIBREDWG = 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.8.2';
var cache = null, modulos = null;
var memoria = {};   // el último doc leído: «Cambiar unidad» no vuelve a decodificar el DWG

function cargarModulos(){
  if (!modulos) modulos = Promise.all([import('./modelo.js'), import('./lector.js'), import('./planos.js'), import('./dibujos.js'), import('./dwg.js')]).catch(function(e){ modulos = null; throw e; });
  return modulos;
}

// → Promise de leer(ArrayBuffer) → db. Si no se puede bajar, rechaza (dwg.js lo informa como dwg_cdn).
function crearLibreDwg(){
  return import(CDN_LIBREDWG + '/dist/libredwg-web.js').then(function(m){
    return m.LibreDwg.create(CDN_LIBREDWG + '/wasm').then(function(lib){
      return self.FugaDwg.lectorLibreDwg(lib, m.Dwg_File_Type.DWG);   // cada lectura libera su memoria de WASM (dwg_free)
    });
  });
}

self.onmessage = function(ev){
  var m = ev.data || {};
  var enviar = function(o){ self.postMessage(o); };
  cargarModulos().then(function(){
    if (!cache) cache = self.FugaDwg.cargadorEnCache(crearLibreDwg);   // por sesión; se descarta si una lectura falla
    return self.FugaDwg.procesar({nombre:m.nombre, bytes:m.bytes, unidad:m.unidad, unaLinea:m.unaLinea, clave:m.clave}, {
      cargarLibreDwg: cache.cargar,
      memoria: memoria,
      alFallarLectura: cache.soltar,
      onProgreso: function(etapa, f){ enviar({tipo:'progreso', etapa:etapa, f:f}); }
    });
  }).then(enviar, function(){ enviar({tipo:'error', codigo:'interno'}); });
};
