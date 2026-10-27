// Lectura de DWG y proceso completo del archivo para la demo «Cómputo desde plano». Corre dentro del Web Worker (trabajador.js) y en Node.
// docDesdeLibreDwg(db) → doc, con la misma forma que lector.leerDxfDoc (ver lector.js), así aplanar y analizar sirven igual para DWG y DXF.
//   «db» es lo que devuelve LibreDwg.convert (@mlightcad/libredwg-web 0.8.2): db.entities (todo el archivo, con ownerBlockRecordSoftId),
//   db.tables.BLOCK_RECORD.entries[{handle, name, basePoint, entities}], db.tables.LAYER.entries[{name, frozen, off}] y db.header.INSUNITS.
//   - Espacio modelo = entidades cuyo dueño es *Model_Space (o sin dueño). Las del espacio papel entran con papel:true. Lo demás
//     (ATTRIB de un INSERT, por ejemplo) no se lee. Si db.entities no trae nada del modelo, se usa *Model_Space.entities.
//   - Bloques: todos los BLOCK_RECORD salvo *Model_Space y *Paper_Space*. Capas: apagada = frozen || off. Unidad: INSUNITS 4 mm, 5 cm, 6 m.
//   - Se leen LINE, ARC, CIRCLE, LWPOLYLINE (cerrada con flag 1 o 512; constantWidth), POLYLINE2D y POLYLINE3D (se saltan los puntos de
//     control de spline y las mallas), TEXT (startPoint), MTEXT e INSERT (columnCount/rowCount = MINSERT). Lo demás no se lee.
//   - La extrusión (OCS) se trata como en el DXF (lector.sentidoOcs/enMundo): (0,0,-1) espeja en X, (0,0,0) es el mundo, otra se salta y se
//     cuenta en doc.errores.extrusion. Una entidad rota se cuenta en doc.errores.saltadas. Sin entidades: doc.errores.motivo = 'vacio'.
// procesar(entrada, opts) → Promise de {tipo:'listo', resultado} o {tipo:'error', codigo}; nunca rechaza ni tira excepción.
//   entrada = {nombre, bytes (ArrayBuffer o Uint8Array), unidad?: 'm'|'cm'|'mm', unaLinea?}. opts = {cargarLibreDwg, onProgreso(etapa, f)}.
//   cargarLibreDwg() → Promise de leer(ArrayBuffer) → db: lo pone el Worker (baja LibreDWG de jsDelivr, una vez por sesión). Solo se llama con un DWG.
//   opts.alFallarLectura() (opcional) se llama si la lectura falla (tira, error >= 128 o sin memoria): el Worker descarta su LibreDWG en caché.
//   cargadorEnCache(crear) → {cargar, soltar} es ese caché, aparte para poder probarlo.
//   lectorLibreDwg(lib, tipo) → leer(buffer) → db con una instancia de LibreDWG: lee, convierte y libera la memoria de WASM (dwg_free)
//     aunque convert falle; sin eso cada lectura deja 25 a 30 MB tomados y, tras unos DWG, uno normal sale como «grande».
//   entrada.clave + opts.memoria (un objeto que guarda el Worker): si la clave (nombre|tamaño|fecha del archivo) es la del último doc leído,
//     no se vuelve a leer el archivo: «Cambiar unidad» solo repite aplanado y análisis. Se guarda un solo doc (el último).
//   Sirve DWG o DXF según los primeros bytes («AC10…» = DWG), no por el nombre. Pasos: lectura → aplanado → lector.aplanar → planos.analizar.
//   resultado = lo de planos.analizar (unidad, escala, origen, dibujos, fondo, avisos) con los avisos del aplanado agregados y
//     lectura:{formato:'dwg'|'dxf', segmentos, saltadas, cortado}.
//   Etapas de onProgreso: 'carga' (solo DWG), 'lectura', 'aplanado', y las de analizar: 'unidad', 'muros', 'dibujos'; f va de 0 a 1.
//   Códigos de error: 'binario' (DXF binario), 'vacio' (sin bytes, sin entidades o sin geometría), 'dwg_viejo' (DWG anterior a R13, dañado,
//   LibreDWG con error ≥ 128 o un trap de WASM al leerlo), 'dwg_cdn' (no se pudo cargar LibreDWG), 'grande' (más de MAX_BYTES o sin memoria de
//   verdad: error 8192 / «out of memory»), 'interno' (cualquier otra falla).
// MAX_BYTES = 60 MB. Necesita lector.js, planos.js y dibujos.js (en el navegador, colgados de self; en Node, require).
(function(root){
  'use strict';
  var nodo = typeof module !== 'undefined' && module.exports;
  function Lc(){ return nodo ? require('./lector.js') : root.FugaLector; }
  function Pl(){ return nodo ? require('./planos.js') : root.FugaPlanos; }

  var UNIDAD = {4:'mm', 5:'cm', 6:'m'};   // $INSUNITS
  var MAX_BYTES = 60 * 1024 * 1024;
  var ESPACIO = /^\*(Model|Paper)_Space/i;

  function hay(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }
  function lista(v){ return Array.isArray(v) ? v : []; }
  function num(v, def){ return typeof v === 'number' && isFinite(v) ? v : def; }
  function pt(p){
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || !isFinite(p.x) || !isFinite(p.y)) throw new Error('punto');
    return [p.x, p.y];
  }
  function esFuera(err){ return !!err && err.message === 'extrusion'; }   // lector.enMundo tira esto con un OCS que no sabe pasar al mundo

  // ---------- una entidad de LibreDWG → la entidad normalizada de lector.js ----------
  function vertices(e, conBulge){
    if (!Array.isArray(e.vertices)) throw new Error('vértices');
    var pts = [];
    e.vertices.forEach(function(v){
      if (v && (v.flag & 16)) return;   // punto de control de spline
      var p = pt(v);
      pts.push(conBulge ? [p[0], p[1], num(v.bulge, 0)] : [p[0], p[1], 0]);
    });
    return pts;
  }
  function convertir(e){
    if (!e || typeof e !== 'object') throw new Error('entidad');
    var L = Lc(), t = e.type, capa = typeof e.layer === 'string' && e.layer ? e.layer : '0';
    function con(tipo, campos){ var o = {capa:capa, papel:false, tipo:tipo}; for (var k in campos) o[k] = campos[k]; return o; }
    function mundo(o){ var d = e.extrusionDirection || {}; return L.enMundo(o, L.sentidoOcs(d.x, d.y, d.z)); }
    var pts, flag;
    if (t === 'LINE') return con('linea', {a:pt(e.startPoint), b:pt(e.endPoint)});
    if (t === 'CIRCLE' || t === 'ARC'){
      if (!(e.radius > 0) || !isFinite(e.radius)) throw new Error('radio');
      var c = pt(e.center);
      if (t === 'CIRCLE') return mundo(con('arco', {c:c, r:e.radius, a0:0, a1:2 * Math.PI}));
      if (!isFinite(e.startAngle) || !isFinite(e.endAngle)) throw new Error('ángulo');
      return mundo(con('arco', {c:c, r:e.radius, a0:e.startAngle, a1:e.endAngle}));
    }
    if (t === 'TEXT' || t === 'MTEXT'){
      var txt = typeof e.text === 'string' ? L.limpiarTexto(e.text) : '';
      if (!txt) return null;
      var x = con('texto', {p:pt(t === 'TEXT' ? e.startPoint || e.insertionPoint : e.insertionPoint), txt:txt});
      return t === 'TEXT' ? mundo(x) : x;   // el punto de un MTEXT es del mundo
    }
    if (t === 'INSERT'){
      if (typeof e.name !== 'string' || !e.name) throw new Error('insert sin nombre');
      return mundo(con('insert', {nombre:e.name, p:pt(e.insertionPoint), sx:num(e.xScale, 1), sy:num(e.yScale, 1), rot:num(e.rotation, 0),
                                  filas:Math.max(1, num(e.rowCount, 1)), cols:Math.max(1, num(e.columnCount, 1))}));
    }
    if (t === 'LWPOLYLINE'){
      pts = vertices(e, true); flag = num(e.flag, 0);
      return pts.length < 2 ? null : mundo(con('poli', {pts:pts, cerrada:(flag & (1 | 512)) !== 0, ancho:e.constantWidth > 0 ? e.constantWidth : null}));
    }
    if (t === 'POLYLINE2D'){
      flag = num(e.flag, 0);
      if (flag & (16 | 64)) return null;   // malla poligonal o polyface: no es planta
      pts = vertices(e, true);
      var w = num(e.startWidth, 0);
      return pts.length < 2 ? null : mundo(con('poli', {pts:pts, cerrada:(flag & 1) === 1, ancho:(w > 0 && w === num(e.endWidth, w)) ? w : null}));
    }
    if (t === 'POLYLINE3D'){   // va en coordenadas del mundo
      pts = vertices(e, false); flag = num(e.flag, 0);
      return pts.length < 2 ? null : con('poli', {pts:pts, cerrada:(flag & 1) === 1, ancho:null});
    }
    return null;   // HATCH, DIMENSION, SOLID, VIEWPORT, ATTDEF… no se leen
  }

  // ---------- docDesdeLibreDwg ----------
  function docDesdeLibreDwg(db){
    var doc = {unidadDeclarada:null, capas:{}, bloques:{}, ents:[], errores:{saltadas:0}};
    function volcar(entidades, dest, papel){
      entidades.forEach(function(e){
        try {
          var x = convertir(e);
          if (x){ if (papel) x.papel = true; dest.push(x); }
        } catch (err) {
          if (esFuera(err)) doc.errores.extrusion = (doc.errores.extrusion || 0) + 1;
          else doc.errores.saltadas++;
        }
      });
    }
    try {
      db = db && typeof db === 'object' ? db : {};
      var T = db.tables && typeof db.tables === 'object' ? db.tables : {}, ins = db.header ? db.header.INSUNITS : undefined;
      if (hay(UNIDAD, ins)) doc.unidadDeclarada = UNIDAD[ins];
      lista(T.LAYER && T.LAYER.entries).forEach(function(l){
        if (!l || typeof l.name !== 'string' || l.name === '__proto__') return;
        doc.capas[l.name] = {apagada: !!(l.frozen || l.off) || (hay(doc.capas, l.name) && doc.capas[l.name].apagada)};
      });

      var modelo = null, papeles = Object.create(null);
      lista(T.BLOCK_RECORD && T.BLOCK_RECORD.entries).forEach(function(b){
        if (!b || typeof b.name !== 'string') return;
        if (ESPACIO.test(b.name)){
          if (/^\*Model_Space/i.test(b.name)) modelo = b; else if (b.handle != null) papeles[String(b.handle)] = true;
          return;
        }
        if (b.name === '__proto__') return;
        var bp = b.basePoint, nb = doc.bloques[b.name] = {base:[num(bp && bp.x, 0), num(bp && bp.y, 0)], ents:[]};
        volcar(lista(b.entities), nb.ents, false);
      });

      var hm = modelo && modelo.handle != null ? String(modelo.handle) : null, delModelo = [], delPapel = [];
      lista(db.entities).forEach(function(e){
        var dueno = e && e.ownerBlockRecordSoftId != null ? String(e.ownerBlockRecordSoftId) : null;
        if (dueno === null || hm === null || dueno === hm) delModelo.push(e);
        else if (papeles[dueno]) delPapel.push(e);
      });
      if (!delModelo.length && modelo) delModelo = lista(modelo.entities);
      volcar(delModelo, doc.ents, false);
      volcar(delPapel, doc.ents, true);
    } catch (err) { /* lo ya leído se conserva */ }
    if (!doc.ents.length) doc.errores.motivo = 'vacio';
    return doc;
  }

  // ---------- proceso completo: bytes → doc → aplanar → analizar ----------
  function Falla(codigo){ this.codigo = codigo; }

  function aBytes(x){
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (x && ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    return null;
  }
  function ascii(b, n){ var s = ''; for (var i = 0; i < n && i < b.length; i++) s += String.fromCharCode(b[i]); return s; }
  // 'dwg' | 'dxf'; tira dwg_viejo si es un DWG anterior a R13 o un .dwg que no es DWG ni DXF
  function formatoDe(b, nombre){
    var m = /^AC(\d{4})/.exec(ascii(b, 6));
    if (m) { if (parseInt(m[1], 10) < 1012) throw new Falla('dwg_viejo'); return 'dwg'; }
    if (/\.dwg$/i.test(String(nombre || '')) && !/SECTION|AutoCAD Binary DXF/.test(ascii(b, 512))) throw new Falla('dwg_viejo');
    return 'dxf';
  }

  // Corre leer(buf) y se queda con el código de error que LibreDWG solo escribe con console.warn (son banderas: cod = el mayor, bits = todas juntas).
  function leerConCodigo(leer, buf){
    var hayConsola = typeof console !== 'undefined' && console, w = hayConsola ? console.warn : null, cod = 0, bits = 0;
    if (hayConsola) console.warn = function(){
      var m = /error code:?\s*(\d+)/i.exec(Array.prototype.join.call(arguments, ' '));
      if (m){ var n = parseInt(m[1], 10); cod = Math.max(cod, n); bits |= n; }
      else if (typeof w === 'function') w.apply(console, arguments);
    };
    try { return {db: leer(buf), cod: cod, bits: bits}; }
    finally { if (hayConsola) console.warn = w; }
  }
  // Una falla al leer: sin memoria de verdad → grande; un trap de WASM (RuntimeError, «memory access out of bounds», unreachable…) es un DWG
  // dañado → dwg_viejo; cualquier otra → null (sigue como interno).
  var SIN_MEMORIA = /\bOOM\b|out of (wasm )?memory|memory.{0,20}(grow|enlarge|allocat)|maximum memory|cannot enlarge/i;
  var TRAP_WASM = /RuntimeError|out of bounds|unreachable|abort|integer overflow|divide by zero|stack overflow|indirect call/i;
  function fallaDeLectura(err){
    var t = String(err && (err.name ? err.name + ': ' : '') + (err && err.message));
    if (/out of bounds/i.test(t)) return new Falla('dwg_viejo');   // trap de V8 («memory access out of bounds») o de JavaScriptCore («Out of bounds memory access»)
    if (SIN_MEMORIA.test(t)) return new Falla('grande');
    return TRAP_WASM.test(t) ? new Falla('dwg_viejo') : null;
  }

  // Tras una falla al leer, la instancia de LibreDWG puede quedar inservible: se avisa para que el Worker la descarte.
  function avisarFalla(opts){ try { if (typeof opts.alFallarLectura === 'function') opts.alFallarLectura(); } catch (e) {} }

  function leerDwg(b, opts, progreso){
    progreso('carga', 0);
    return Promise.resolve().then(function(){
      if (typeof opts.cargarLibreDwg !== 'function') throw new Error('sin cargador');
      return opts.cargarLibreDwg();
    }).then(function(leer){
      if (typeof leer !== 'function') throw new Falla('dwg_cdn');
      return leer;
    }, function(){ throw new Falla('dwg_cdn'); }).then(function(leer){
      progreso('carga', 1); progreso('lectura', 0);
      var buf = b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      var r;
      try { r = leerConCodigo(leer, buf); }
      catch (err) { avisarFalla(opts); throw fallaDeLectura(err) || err; }
      if (r.bits & 8192){ avisarFalla(opts); throw new Falla('grande'); }   // OUTOFMEM de LibreDWG
      if (r.cod >= 128){ avisarFalla(opts); throw new Falla('dwg_viejo'); }
      var doc = docDesdeLibreDwg(r.db);
      progreso('lectura', 1);
      return doc;
    });
  }

  function seguir(doc, formato, entrada, progreso){
    var L = Lc(), motivo = doc.errores && doc.errores.motivo;
    if (motivo === 'binario' || motivo === 'vacio') throw new Falla(motivo);
    progreso('aplanado', 0);
    var ap = L.aplanar(doc);
    progreso('aplanado', 1);
    if (!ap.segmentos.length && !ap.arcos.length && !ap.textos.length) throw new Falla(ap.avisos.indexOf('error') >= 0 ? 'interno' : 'vacio');
    var res = Pl().analizar(ap, {declarada:doc.unidadDeclarada, unidad:entrada.unidad, unaLinea:!!entrada.unaLinea, onProgreso:progreso});
    if (!res.dibujos.length && res.avisos.indexOf('error') >= 0) throw new Falla('interno');
    ap.avisos.forEach(function(a){ if (res.avisos.indexOf(a) < 0) res.avisos.push(a); });
    res.lectura = {formato:formato, segmentos:ap.segmentos.length, saltadas:(doc.errores && doc.errores.saltadas) | 0, cortado:!!ap.cortado};
    return {tipo:'listo', resultado:res};
  }

  function procesar(entrada, opts){
    entrada = entrada || {}; opts = opts || {};
    var progreso = function(etapa, f){ try { if (typeof opts.onProgreso === 'function') opts.onProgreso(etapa, f); } catch (e) {} };
    var mem = opts.memoria && typeof opts.memoria === 'object' ? opts.memoria : null, clave = entrada.clave == null ? null : String(entrada.clave);
    return Promise.resolve().then(function(){
      var b = aBytes(entrada.bytes);
      if (!b || !b.length) throw new Falla('vacio');
      if (b.length > MAX_BYTES) throw new Falla('grande');
      var formato = formatoDe(b, entrada.nombre);
      if (mem && clave && mem.clave === clave && mem.formato === formato && mem.doc) return seguir(mem.doc, formato, entrada, progreso);
      var guardar = function(doc){ if (mem && clave){ mem.clave = clave; mem.formato = formato; mem.doc = doc; } return doc; };
      if (mem){ mem.clave = null; mem.doc = null; }   // el doc anterior se suelta antes de leer otro archivo
      if (formato === 'dwg')
        return leerDwg(b, opts, progreso).then(function(doc){ return seguir(guardar(doc), 'dwg', entrada, progreso); });
      progreso('lectura', 0);
      var doc = guardar(Lc().leerDxfDoc(b));
      progreso('lectura', 1);
      return seguir(doc, 'dxf', entrada, progreso);
    }).then(null, function(err){
      return {tipo:'error', codigo: err instanceof Falla ? err.codigo : 'interno'};
    });
  }

  // cargadorEnCache(crear) → {cargar, soltar}: crear() es una Promise de leer(); cargar() la guarda (por sesión del Worker; si falla, no queda
  // guardada) y soltar() la descarta para que el próximo DWG vuelva a crear LibreDWG.
  function cargadorEnCache(crear){
    var p = null;
    return {
      cargar: function(){
        if (!p){
          var mia = p = Promise.resolve().then(crear);
          mia.then(null, function(){ if (p === mia) p = null; });
        }
        return p;
      },
      soltar: function(){ p = null; }
    };
  }

  function lectorLibreDwg(lib, tipo){
    return function(buffer){
      var d = null;
      try { d = lib.dwg_read_data(buffer, tipo); return lib.convert(d); }
      finally { if (d) try { lib.dwg_free(d); } catch (e) { /* lo convertido ya está en JS */ } }
    };
  }

  var api = {docDesdeLibreDwg:docDesdeLibreDwg, procesar:procesar, cargadorEnCache:cargadorEnCache, lectorLibreDwg:lectorLibreDwg, MAX_BYTES:MAX_BYTES};
  if (nodo) module.exports = api;
  else root.FugaDwg = api;
})(typeof self !== 'undefined' ? self : this);
