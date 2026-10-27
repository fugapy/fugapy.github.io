// Lector robusto de DXF para la demo «Cómputo desde plano»: texto o bytes → documento normalizado → geometría plana.
// leerDxfDoc(entrada) → doc = {unidadDeclarada:'m'|'cm'|'mm'|null, capas:{nombre:{apagada}}, bloques:{nombre:{base,ents}},
//   ents:[...], errores:{saltadas, motivo?}}. «entrada» es un string o bytes (ArrayBuffer/Uint8Array). Nunca tira excepción.
//   motivo = 'binario' (DXF binario) o 'vacio' (sin nada legible o sin sección ENTITIES).
//   errores.extrusion (solo si hay) = entidades salteadas por tener un sistema de coordenadas de objeto (OCS) que no es el del mundo.
//   Entidades (todas con capa, papel y tipo; ángulos en radianes):
//     {tipo:'linea', a, b} · {tipo:'poli', pts:[[x,y,bulge]], cerrada, ancho} · {tipo:'arco', c, r, a0, a1} (CIRCLE = 0..2π)
//     {tipo:'texto', p, txt} · {tipo:'insert', nombre, p, sx, sy, rot, filas, cols}
// aplanar(doc, lim) → {segmentos:[{a,b,capa,ancho}], arcos:[{c,r,a0,a1,capa}], textos:[{p,txt,capa}], avisos:[código], cortado}
//   en las unidades del archivo, sin escalar. Resuelve INSERT anidados (espejo, rotación, escala), la capa 0 heredada,
//   descarta espacio papel y capas apagadas/congeladas, y aproxima los bulges con cuerdas de 15° como máximo.
//   Avisos: 'grande' (tope alcanzado, cortado=true), 'error' (falla inesperada), 'bloque_inexistente', 'bloque_recursivo', 'anidado_profundo',
//   'escala_invalida', 'minsert' (solo se dibuja la primera copia), 'extrusion' (hubo entidades salteadas por su OCS).
//   Las capas se buscan sin distinguir mayúsculas, como AutoCAD.
// OCS: ARC, CIRCLE, LWPOLYLINE, POLYLINE 2D, TEXT e INSERT guardan sus puntos en el OCS que fija la extrusión (210/220/230 en DXF,
//   extrusionDirection en DWG). (0,0,1) o sin extrusión: el mundo. (0,0,-1): espejo en X (x → −x, ángulos y bulges espejados). Cualquier otra
//   extrusión: la entidad no se lee y se cuenta en errores.extrusion. LINE y MTEXT van en coordenadas del mundo y no se tocan.
// sentidoOcs(x, y, z) → 1 | -1 | 0 (vector nulo o ausente = 1) y enMundo(ent, sentido) → la entidad en el mundo (tira error si sentido = 0);
//   dwg.js los usa para hacer lo mismo con DWG. limpiarTexto(s) → texto sin códigos de formato de MTEXT ni %%.
// Funciona en Node, en la página y dentro de un Web Worker (se cuelga de self).
(function(root){
  'use strict';
  var DOS_PI = 2 * Math.PI, GRAD = Math.PI / 180;
  var LIM_DEF = {maxSegmentos:400000, maxInserts:200000, maxProfundidad:10};
  var CUERDA_MAX = 15 * GRAD;           // ángulo máximo de una cuerda al aproximar un bulge
  var ESCALA_MAX = 10000;
  var UNIDAD = {4:'mm', 5:'cm', 6:'m'}; // $INSUNITS
  var BINARIO = 'AutoCAD Binary DXF';
  var FUERA = new Error('extrusion');   // se tira cuando una entidad tiene un OCS que no se sabe pasar al mundo

  function hay(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }
  function fin(p){ return isFinite(p[0]) && isFinite(p[1]); }

  // ---------- decodificación ----------
  function aTexto(entrada){
    if (typeof entrada === 'string') return entrada;
    var b = null;
    if (entrada instanceof ArrayBuffer) b = new Uint8Array(entrada);
    else if (entrada && ArrayBuffer.isView(entrada)) b = new Uint8Array(entrada.buffer, entrada.byteOffset, entrada.byteLength);
    if (!b) return '';
    var cab = '';
    for (var i = 0; i < BINARIO.length && i < b.length; i++) cab += String.fromCharCode(b[i]);
    if (cab === BINARIO) return BINARIO;
    if (typeof TextDecoder === 'undefined'){ var s = ''; for (var k = 0; k < b.length; k++) s += String.fromCharCode(b[k]); return s; }
    // R2007+ guarda UTF-8 aunque $DWGCODEPAGE diga ANSI_1252: si los bytes son UTF-8 válido se lee como UTF-8
    try { return new TextDecoder('utf-8', {fatal:true}).decode(b); } catch (e) {}
    var m = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*([^\r\n]+)/.exec(new TextDecoder('windows-1252').decode(b.subarray(0, 262144)));
    if (!m || /^ANSI_1252$/i.test(m[1].trim())) return new TextDecoder('windows-1252').decode(b);
    return new TextDecoder('utf-8').decode(b);
  }

  // ---------- texto: limpiar códigos de formato de MTEXT y %% ----------
  function limpiarTexto(s){
    s = String(s)
      .replace(/\\\\/g, '\u0001').replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003')
      .replace(/\\U\+([0-9A-Fa-f]{4})/g, function(_, h){ return String.fromCharCode(parseInt(h, 16)); })
      .replace(/\\S([^;]*);/g, function(_, t){ return t.replace(/[\^#]/g, '/'); })   // fracciones apiladas: se conserva el contenido
      .replace(/\\[fFhHcCtTqQwWaAp][^;]*;/g, '')                                       // fuente, alto, color, alineación…
      .replace(/\\[LlOoKk]/g, '').replace(/\\~/g, ' ')
      .replace(/\\P/g, ' ').replace(/[{}]/g, '')
      .replace(/%%c/gi, 'Ø').replace(/%%d/gi, '°').replace(/%%p/gi, '±').replace(/%%[uo]/gi, '')
      .replace(/%%(\d{3})/g, function(_, n){ return String.fromCharCode(parseInt(n, 10)); })
      .replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}');
    return s.replace(/\s+/g, ' ').trim();
  }

  // ---------- OCS: pasar las entidades al mundo ----------
  function comp(v, def){ v = parseFloat(v); return isFinite(v) ? v : def; }
  function sentidoOcs(x, y, z){
    x = comp(x, 0); y = comp(y, 0); z = comp(z, 1);
    var n = Math.sqrt(x * x + y * y + z * z);
    if (n < 1e-9) return 1;
    if (Math.abs(x / n) > 1e-6 || Math.abs(y / n) > 1e-6) return 0;
    return z > 0 ? 1 : -1;
  }
  function enMundo(e, sentido){
    if (!e || sentido === 1) return e;
    if (sentido !== -1) throw FUERA;
    var o = {}, k, m = function(p){ return [-p[0], p[1]]; };
    for (k in e) o[k] = e[k];
    if (e.tipo === 'arco'){ o.c = m(e.c); o.a0 = Math.PI - e.a1; o.a1 = Math.PI - e.a0; }   // el espejo invierte el sentido
    else if (e.tipo === 'poli') o.pts = e.pts.map(function(q){ return [-q[0], q[1], q[2] ? -q[2] : 0]; });
    else if (e.tipo === 'insert'){ o.p = m(e.p); o.rot = Math.PI - e.rot; o.sy = -e.sy; }      // F·R(θ)·diag(sx, sy) = R(π−θ)·diag(sx, −sy)
    else o.p = m(e.p);                                                                          // texto
    return o;
  }

  // ---------- campos de una entidad (c = [código, valor, código, valor…]) ----------
  function g(c, cod){ for (var i = 0; i < c.length; i += 2) if (c[i] === cod) return c[i+1]; return undefined; }
  function nm(c, cod, def){
    var v = g(c, cod);
    if (v === undefined){ if (def === undefined) throw new Error('falta ' + cod); return def; }
    var x = parseFloat(v);
    if (!isFinite(x)) throw new Error('número ' + cod);
    return x;
  }
  function pt(c, k){ return [nm(c, '1' + k), nm(c, '2' + k)]; }

  function convertir(e){
    var c = e.c, t = e.t, base = {capa: g(c, '8') || '0', papel: g(c, '67') === '1'}, x, i;
    function con(tipo, campos){ var o = {capa:base.capa, papel:base.papel, tipo:tipo}; for (var k in campos) o[k] = campos[k]; return o; }
    function mundo(o){ return enMundo(o, sentidoOcs(g(c, '210'), g(c, '220'), g(c, '230'))); }
    if (t === 'LINE') return con('linea', {a:pt(c, 0), b:pt(c, 1)});
    if (t === 'CIRCLE' || t === 'ARC'){
      var r = nm(c, '40');
      if (!(r > 0)) throw new Error('radio');
      return mundo(t === 'CIRCLE' ? con('arco', {c:pt(c, 0), r:r, a0:0, a1:DOS_PI})
                                  : con('arco', {c:pt(c, 0), r:r, a0:nm(c, '50') * GRAD, a1:nm(c, '51') * GRAD}));
    }
    if (t === 'TEXT' || t === 'MTEXT'){
      var txt = '';
      for (i = 0; i < c.length; i += 2) if (c[i] === '3') txt += c[i+1];      // MTEXT largo: trozos de 250 en el 3, el resto en el 1
      txt = limpiarTexto(txt + (g(c, '1') || ''));
      if (!txt) return null;
      x = con('texto', {p:pt(c, 0), txt:txt});
      return t === 'TEXT' ? mundo(x) : x;                                       // el punto de un MTEXT es del mundo
    }
    if (t === 'INSERT'){
      var nombre = g(c, '2');
      if (!nombre) throw new Error('insert sin nombre');
      return mundo(con('insert', {nombre:nombre, p:pt(c, 0), sx:nm(c, '41', 1), sy:nm(c, '42', 1), rot:nm(c, '50', 0) * GRAD,
                                  filas:Math.max(1, nm(c, '71', 1)), cols:Math.max(1, nm(c, '70', 1))}));
    }
    if (t === 'LWPOLYLINE'){
      var pts = [], cur = null, flags = 0, ancho = null;
      for (i = 0; i < c.length; i += 2){
        var cod = c[i], v = parseFloat(c[i+1]);
        if (cod === '10'){ cur = [v, NaN, 0]; pts.push(cur); }
        else if (cod === '20' && cur) cur[1] = v;
        else if (cod === '42' && cur) cur[2] = isFinite(v) ? v : 0;
        else if (cod === '70') flags = parseInt(c[i+1], 10) || 0;
        else if (cod === '43' && v > 0) ancho = v;
      }
      for (i = 0; i < pts.length; i++) if (!fin(pts[i])) throw new Error('vértice');
      return pts.length < 2 ? null : mundo(con('poli', {pts:pts, cerrada:(flags & 1) === 1, ancho:ancho}));
    }
    return null;   // SOLID, HATCH, DIMENSION, ATTRIB… no se leen
  }

  function polilinea(p){   // POLYLINE 2D/3D + VERTEX, ya reunidos
    var c = p.e.c, flags = nm(c, '70', 0);
    if (flags & (16 | 64)) return null;   // malla poligonal o polyface: no es planta
    var pts = [], w = nm(c, '40', 0);
    p.v.forEach(function(vc){
      if ((nm(vc, '70', 0) & 16) === 0) pts.push([nm(vc, '10'), nm(vc, '20'), nm(vc, '42', 0)]);   // 16 = punto de control de spline
    });
    if (pts.length < 2) return null;
    return enMundo({capa:g(c, '8') || '0', papel:g(c, '67') === '1', tipo:'poli', pts:pts, cerrada:(flags & 1) === 1,
                    ancho:(w > 0 && w === nm(c, '41', w)) ? w : null},
                   (flags & 8) ? 1 : sentidoOcs(g(c, '210'), g(c, '220'), g(c, '230')));   // una polilínea 3D va en coordenadas del mundo
  }

  // ---------- lectura: un solo recorrido por los pares código/valor ----------
  function leerDxfDoc(entrada){
    var doc = {unidadDeclarada:null, capas:{}, bloques:{}, ents:[], errores:{saltadas:0}};
    try {
      var texto = aTexto(entrada);
      if (texto === BINARIO || texto.slice(0, BINARIO.length) === BINARIO){ doc.errores.motivo = 'binario'; return doc; }
      var L = texto.split(/\r\n|\n|\r/), seccion = null, vioEnts = false, hv = null, cur = null, poli = null, bloque = null;
      var perdida = function(err){
        if (err === FUERA) doc.errores.extrusion = (doc.errores.extrusion || 0) + 1;
        else doc.errores.saltadas++;
      };

      var cerrarPoli = function(){
        if (!poli) return;
        var p = poli; poli = null;
        try { var x = polilinea(p); if (x) p.dest.push(x); } catch (err) { perdida(err); }
      };
      var entidad = function(e, dest){
        if (e.t === 'VERTEX'){ if (poli) poli.v.push(e.c); return; }
        cerrarPoli();
        if (e.t === 'SEQEND') return;
        if (e.t === 'POLYLINE'){ poli = {e:e, dest:dest, v:[]}; return; }
        try { var x = convertir(e); if (x) dest.push(x); } catch (err) { perdida(err); }
      };
      var cerrar = function(e){
        if (!e) return;
        if (seccion === 'TABLES'){
          if (e.t !== 'LAYER') return;
          try {
            var n = g(e.c, '2'), col = nm(e.c, '62', 0), fl = nm(e.c, '70', 0);
            if (n && n !== '__proto__') doc.capas[n] = {apagada: col < 0 || (fl & 1) === 1};
          } catch (err) { perdida(); }
        } else if (seccion === 'BLOCKS'){
          if (e.t === 'BLOCK'){
            cerrarPoli();
            var nb = g(e.c, '2');
            bloque = null;
            if (nb && nb !== '__proto__' && !/^\*(Model|Paper)_Space/i.test(nb)){
              try { bloque = doc.bloques[nb] = {base:[nm(e.c, '10', 0), nm(e.c, '20', 0)], ents:[]}; } catch (err) { perdida(); }
            }
          } else if (e.t === 'ENDBLK'){ cerrarPoli(); bloque = null; }
          else if (bloque) entidad(e, bloque.ents);
        } else if (seccion === 'ENTITIES') entidad(e, doc.ents);
      };

      for (var i = 0; i + 1 < L.length; i += 2){
        var c = L[i].trim(), v = c === '3' || c === '1' ? L[i+1] : L[i+1].trim();   // los textos conservan el espacio entre trozos de MTEXT
        if (c === '0'){
          cerrar(cur); cur = null;
          if (v === 'SECTION') seccion = '?';
          else if (v === 'ENDSEC'){ cerrarPoli(); seccion = null; bloque = null; }
          else if (v === 'EOF') break;
          else if (seccion === 'TABLES' || seccion === 'BLOCKS' || seccion === 'ENTITIES') cur = {t:v, c:[]};
        } else if (seccion === '?' && c === '2'){ seccion = v; if (v === 'ENTITIES') vioEnts = true; }
        else if (seccion === 'HEADER'){
          if (c === '9') hv = v;
          else if (hv === '$INSUNITS' && c === '70'){ var u = UNIDAD[parseInt(v, 10)]; doc.unidadDeclarada = u || null; hv = null; }
        } else if (cur) cur.c.push(c, v);
      }
      cerrar(cur); cerrarPoli();
      if (!vioEnts) doc.errores.motivo = 'vacio';
    } catch (err) {
      if (!doc.ents.length) doc.errores.motivo = 'vacio';
    }
    return doc;
  }

  // ---------- aplanar: INSERT → coordenadas del dibujo ----------
  // Matriz afín [a,b,c,d,e,f]: x' = a·x + c·y + e ; y' = b·x + d·y + f
  var ID = [1, 0, 0, 1, 0, 0];
  function mul(M, N){
    return [M[0]*N[0] + M[2]*N[1], M[1]*N[0] + M[3]*N[1], M[0]*N[2] + M[2]*N[3], M[1]*N[2] + M[3]*N[3],
            M[0]*N[4] + M[2]*N[5] + M[4], M[1]*N[4] + M[3]*N[5] + M[5]];
  }
  function tr(M, p){ return [M[0]*p[0] + M[2]*p[1] + M[4] + 0, M[1]*p[0] + M[3]*p[1] + M[5] + 0]; }   // «+ 0» evita el -0
  function snap(v){ return Math.abs(v) < 1e-12 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-12 ? (v < 0 ? -1 : 1) : v; }
  function escalaOk(s){ return isFinite(s) && s !== 0 && Math.abs(s) <= ESCALA_MAX; }

  function aplanar(doc, lim){
    var K = {};
    for (var k in LIM_DEF) K[k] = lim && isFinite(lim[k]) ? lim[k] : LIM_DEF[k];
    doc = doc || {};
    var capas = doc.capas || {}, bloques = doc.bloques || {}, apag = Object.create(null);
    for (var kc in capas) if (hay(capas, kc) && capas[kc] && capas[kc].apagada) apag[String(kc).toUpperCase()] = true;   // AutoCAD no distingue mayúsculas
    var out = {segmentos:[], arcos:[], textos:[], avisos:[], cortado:false}, parar = false, nInserts = 0;

    function aviso(cod){ if (out.avisos.indexOf(cod) < 0) out.avisos.push(cod); }
    function cortar(){ out.cortado = true; parar = true; aviso('grande'); }
    function apagada(n){ return apag[String(n).toUpperCase()] === true; }

    function seg(M, a, b, capa, ancho){
      if (out.segmentos.length >= K.maxSegmentos){ cortar(); return; }
      var p = tr(M, a), q = tr(M, b);
      if (fin(p) && fin(q)) out.segmentos.push({a:p, b:q, capa:capa, ancho: ancho == null ? null : ancho * Math.hypot(M[0], M[1])});
    }
    function tramo(M, p, q, bulge, capa, ancho){
      var th = isFinite(bulge) ? 4 * Math.atan(bulge) : 0;
      if (Math.abs(bulge) < 1e-9 || !th){ seg(M, p, q, capa, ancho); return; }
      var dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
      if (!(len > 0)){ return; }
      var h = (len / 2) / Math.tan(th / 2);                       // del punto medio al centro, hacia la izquierda de p→q
      var cx = (p[0] + q[0]) / 2 - dy / len * h, cy = (p[1] + q[1]) / 2 + dx / len * h;
      var n = Math.ceil(Math.abs(th) / CUERDA_MAX - 1e-9), prev = p;
      for (var j = 1; j <= n; j++){
        var cur = q;
        if (j < n){
          var ang = j * th / n, co = Math.cos(ang), si = Math.sin(ang), rx = p[0] - cx, ry = p[1] - cy;
          cur = [cx + rx * co - ry * si, cy + rx * si + ry * co];
        }
        seg(M, prev, cur, capa, ancho);
        prev = cur;
        if (parar) return;
      }
    }

    function insertar(e, M, capaEf, nivel, ruta){
      if (nInserts >= K.maxInserts){ cortar(); return; }
      if (nivel > K.maxProfundidad){ aviso('anidado_profundo'); return; }
      if (!hay(bloques, e.nombre)){ aviso('bloque_inexistente'); return; }
      if (ruta.indexOf(e.nombre) >= 0){ aviso('bloque_recursivo'); return; }
      if (!escalaOk(e.sx) || !escalaOk(e.sy) || !isFinite(e.rot) || !fin(e.p)){ aviso('escala_invalida'); return; }
      if (e.filas > 1 || e.cols > 1) aviso('minsert');            // MINSERT: solo la primera copia
      nInserts++;
      var B = bloques[e.nombre], co = snap(Math.cos(e.rot)), si = snap(Math.sin(e.rot));
      var a = e.sx * co, b = e.sx * si, c = -e.sy * si, d = e.sy * co;
      var Ml = [a, b, c, d, e.p[0] - (a * B.base[0] + c * B.base[1]), e.p[1] - (b * B.base[0] + d * B.base[1])];
      ruta.push(e.nombre);
      recorrer(B.ents || [], mul(M, Ml), capaEf, nivel, ruta);
      ruta.pop();
    }

    function recorrer(ents, M, capaPadre, nivel, ruta){
      for (var i = 0; i < ents.length && !parar; i++){
        var e = ents[i];
        var capa = capaPadre !== null && e.capa === '0' ? capaPadre : e.capa;   // la capa 0 de un bloque toma la del INSERT
        if (e.papel || apagada(capa)) continue;
        if (e.tipo === 'linea') seg(M, e.a, e.b, capa, null);
        else if (e.tipo === 'poli'){
          var n = e.pts.length;
          for (var j = 0; j + 1 < n && !parar; j++) tramo(M, e.pts[j], e.pts[j+1], e.pts[j][2], capa, e.ancho);
          if (e.cerrada && !parar && (n > 2 || Math.abs(e.pts[n-1][2]) > 1e-9)) tramo(M, e.pts[n-1], e.pts[0], e.pts[n-1][2], capa, e.ancho);
        } else if (e.tipo === 'arco'){
          if (out.arcos.length >= K.maxSegmentos){ cortar(); break; }
          var rho = Math.atan2(M[1] + 0, M[0]), espejo = M[0] * M[3] - M[1] * M[2] < 0, ce = tr(M, e.c);
          if (fin(ce)) out.arcos.push({c:ce, r:e.r * Math.hypot(M[0], M[1]), capa:capa,
            a0: espejo ? rho - e.a1 : e.a0 + rho, a1: espejo ? rho - e.a0 : e.a1 + rho});   // el espejo invierte el sentido
        } else if (e.tipo === 'texto'){
          if (out.textos.length >= K.maxSegmentos){ cortar(); break; }
          var tp = tr(M, e.p);
          if (fin(tp)) out.textos.push({p:tp, txt:e.txt, capa:capa});
        } else if (e.tipo === 'insert') insertar(e, M, capa, nivel + 1, ruta);
      }
    }

    if (doc.errores && doc.errores.extrusion > 0) aviso('extrusion');
    try { recorrer(doc.ents || [], ID, null, 0, []); } catch (err) { aviso('error'); }
    return out;
  }

  var api = {leerDxfDoc:leerDxfDoc, aplanar:aplanar, limpiarTexto:limpiarTexto, sentidoOcs:sentidoOcs, enMundo:enMundo};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FugaLector = api;
})(typeof self !== 'undefined' ? self : this);
