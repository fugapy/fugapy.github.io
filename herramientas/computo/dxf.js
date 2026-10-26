// Lector mínimo de DXF y detección de muros por doble línea, para la demo «Cómputo desde plano».
// leerDxf(texto) → {segmentos:[{a,b,capa}], unidad, unidadDeclarada, escala}; todo sale en metros.
// detectarPlano(segmentos) → {muros, aberturas}: muros con el formato de Modelo ({id,de,a,esp,tipo,propuesto})
// y aberturas propuestas ({id,muro,desde,ancho,alto,tipo,propuesto}). detectarMuros(segmentos) = detectarPlano(...).muros.
// No resuelve INSERT/bloques ni SOLID/HATCH: los muros dentro de bloques hay que explotarlos antes de guardar el DXF.
(function(root){
  'use strict';
  // Exteriores por contorno: la misma regla que usa medir() (modelo.js se carga antes que dxf.js)
  var Mo = typeof module !== 'undefined' && module.exports ? require('./modelo.js') : root.FugaModelo;
  var UNIDAD_INSUNITS = {4:'mm', 5:'cm', 6:'m'};
  var ESCALA = {m:1, cm:0.01, mm:0.001};
  var CAPAS_IGNORADAS = /cota|dim|text|mob|eje|hatch|achur|vegeta|equip|lote|r[oó]tulo|retiro|l[ií]mite|terreno|poche/i;
  var ESP_MIN = 0.10, ESP_MAX = 0.30;   // separación de la doble línea (m)
  var SOLAPE_MIN = 0.50;                // tramo mínimo en común (m)
  var ANGULO_MAX = 2 * Math.PI / 180;   // paralelismo
  var SEN = Math.sin(ANGULO_MAX);
  var REUSO_MAX = 0.05;                 // un segmento puede entrar en varios pares si los tramos no se pisan más que esto
  var HUECO_MAX = 2.50;                 // hueco máximo entre tramos colineales que se une en un solo muro
  var ABERTURA_MIN = 0.40;              // un hueco más corto es un encuentro de muros, no una abertura
  var PLANO_MIN = 3, PLANO_MAX = 2000;  // lado mayor razonable de una planta (m) con la unidad declarada

  // Pares código/valor de un DXF (tolera CRLF, espacios y línea final suelta).
  function pares(texto){
    var l = String(texto == null ? '' : texto).split(/\r\n|\n|\r/), out = [];
    for (var i = 0; i + 1 < l.length; i += 2) out.push([l[i].trim(), l[i+1].trim()]);
    return out;
  }
  function f(v){ var n = parseFloat(v); return isFinite(n) ? n : NaN; }
  function r(v){ return Math.round(v * 1e4) / 1e4; }

  function leerDxf(texto){
    var P = pares(texto), seccion = null, insunits = null, ents = [], cur = null;
    for (var i = 0; i < P.length; i++){
      var c = P[i][0], v = P[i][1];
      if (c === '0' && v === 'SECTION'){ seccion = '?'; continue; }
      if (c === '2' && seccion === '?'){ seccion = v; continue; }
      if (c === '0' && v === 'ENDSEC'){ seccion = null; cur = null; continue; }
      if (seccion === 'HEADER'){
        if (c === '9' && v === '$INSUNITS' && i + 1 < P.length && P[i+1][0] === '70') insunits = parseInt(P[i+1][1], 10);
      } else if (seccion === 'ENTITIES'){
        if (c === '0'){ cur = {tipo:v, capa:'0', c:[]}; ents.push(cur); }
        else if (cur){ if (c === '8') cur.capa = v; else if (c === '67') cur.papel = v === '1'; else cur.c.push([c, v]); }
      }
    }
    var crudos = [], poli = null;      // segmentos en unidades del dibujo
    function seg(a, b, capa){ if (a && b && isFinite(a[0] + a[1] + b[0] + b[1])) crudos.push({a:a, b:b, capa:capa}); }
    function cadena(pts, cerrada, capa){
      for (var k = 0; k + 1 < pts.length; k++) seg(pts[k], pts[k+1], capa);
      if (cerrada && pts.length > 2) seg(pts[pts.length - 1], pts[0], capa);
    }
    ents.forEach(function(e){
      if (e.papel) return;               // espacio papel (código 67 = 1): marcos, rótulos, no es el modelo
      var d, k;
      if (e.tipo === 'LINE'){
        d = {}; e.c.forEach(function(p){ if (!(p[0] in d)) d[p[0]] = f(p[1]); });
        seg([d['10'], d['20']], [d['11'], d['21']], e.capa);
      } else if (e.tipo === 'LWPOLYLINE'){
        var pts = [], flags = 0;
        for (k = 0; k < e.c.length; k++){
          if (e.c[k][0] === '70') flags = parseInt(e.c[k][1], 10) || 0;
          else if (e.c[k][0] === '10') pts.push([f(e.c[k][1]), NaN]);
          else if (e.c[k][0] === '20' && pts.length) pts[pts.length - 1][1] = f(e.c[k][1]);
        }
        cadena(pts.filter(function(p){ return isFinite(p[0] + p[1]); }), flags & 1, e.capa);
      } else if (e.tipo === 'POLYLINE'){
        var fl = 0; e.c.forEach(function(p){ if (p[0] === '70') fl = parseInt(p[1], 10) || 0; });
        poli = {pts:[], cerrada:fl & 1, capa:e.capa};
      } else if (e.tipo === 'VERTEX' && poli){
        d = {}; e.c.forEach(function(p){ if (!(p[0] in d)) d[p[0]] = f(p[1]); });
        if (isFinite(d['10'] + d['20'])) poli.pts.push([d['10'], d['20']]);
      } else if (e.tipo === 'SEQEND' && poli){
        cadena(poli.pts, poli.cerrada, poli.capa); poli = null;
      }
    });
    if (poli) cadena(poli.pts, poli.cerrada, poli.capa);   // POLYLINE sin SEQEND
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;   // en bucle: Math.max.apply revienta con ~100.000 argumentos
    crudos.forEach(function(s){
      x0 = Math.min(x0, s.a[0], s.b[0]); x1 = Math.max(x1, s.a[0], s.b[0]);
      y0 = Math.min(y0, s.a[1], s.b[1]); y1 = Math.max(y1, s.a[1], s.b[1]);
    });
    var ext = crudos.length ? Math.max(x1 - x0, y1 - y0) : 0;
    var declarada = UNIDAD_INSUNITS[insunits] || null, unidad = declarada;
    // Sin unidad, o con una que deja la planta de menos de 3 m o más de 2 km: se adivina por la extensión mayor
    if (!unidad || (crudos.length && (ext * ESCALA[unidad] < PLANO_MIN || ext * ESCALA[unidad] > PLANO_MAX)))
      unidad = ext > 1000 ? 'mm' : ext > 100 ? 'cm' : 'm';
    var k2 = ESCALA[unidad];
    return {
      segmentos: crudos.map(function(s){ return {a:[s.a[0]*k2, s.a[1]*k2], b:[s.b[0]*k2, s.b[1]*k2], capa:s.capa}; }),
      unidad: unidad, unidadDeclarada: declarada, escala: k2
    };
  }

  // Pares de líneas paralelas → tramos de muro; se unen los tramos colineales separados por un hueco
  // y cada hueco queda como abertura propuesta (puerta, o ventana si hay líneas dentro del hueco).
  function detectarPlano(segmentos){
    var S = [];
    (segmentos || []).forEach(function(s){
      if (CAPAS_IGNORADAS.test(String(s.capa || ''))) return;
      var dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], L = Math.hypot(dx, dy);
      if (L < 1e-6) return;
      S.push({a:s.a, b:s.b, L:L, ux:dx/L, uy:dy/L});
    });
    var cand = [], i, j;
    for (i = 0; i < S.length; i++) for (j = i + 1; j < S.length; j++){
      var p = S[i], q = S[j];
      if (Math.abs(p.ux*q.uy - p.uy*q.ux) > SEN) continue;
      // marco de p: t a lo largo, n transversal
      var nx = -p.uy, ny = p.ux;
      var d1 = (q.a[0] - p.a[0])*nx + (q.a[1] - p.a[1])*ny, d2 = (q.b[0] - p.a[0])*nx + (q.b[1] - p.a[1])*ny;
      var sep = Math.abs((d1 + d2) / 2);
      if (sep < ESP_MIN - 1e-9 || sep > ESP_MAX + 1e-9) continue;
      var t1 = (q.a[0] - p.a[0])*p.ux + (q.a[1] - p.a[1])*p.uy, t2 = (q.b[0] - p.a[0])*p.ux + (q.b[1] - p.a[1])*p.uy;
      var t0 = Math.max(0, Math.min(t1, t2)), t3 = Math.min(p.L, Math.max(t1, t2));
      if (t3 - t0 < SOLAPE_MIN - 1e-9) continue;
      cand.push({i:i, j:j, sep:sep, t0:t0, t3:t3, dn:(d1 + d2) / 4});   // dn = desplazamiento del eje medio respecto de p
    }
    cand.sort(function(x, y){ return x.sep - y.sep; });
    // Un segmento puede entrar en varios pares si los tramos usados no se pisan más de REUSO_MAX.
    var usos = S.map(function(){ return []; });
    function libre(k, i0, i1){
      return usos[k].every(function(u){ return Math.min(u[1], i1) - Math.max(u[0], i0) <= REUSO_MAX; });
    }
    var tramos = [];
    cand.forEach(function(c){
      var p = S[c.i], q = S[c.j];
      var tq0 = (p.a[0] + p.ux*c.t0 - q.a[0])*q.ux + (p.a[1] + p.uy*c.t0 - q.a[1])*q.uy;
      var tq1 = (p.a[0] + p.ux*c.t3 - q.a[0])*q.ux + (p.a[1] + p.uy*c.t3 - q.a[1])*q.uy;
      var q0 = Math.min(tq0, tq1), q1 = Math.max(tq0, tq1);
      if (!libre(c.i, c.t0, c.t3) || !libre(c.j, q0, q1)) return;
      usos[c.i].push([c.t0, c.t3]); usos[c.j].push([q0, q1]);
      var nx = -p.uy, ny = p.ux;
      var A = [p.a[0] + p.ux*c.t0 + nx*c.dn, p.a[1] + p.uy*c.t0 + ny*c.dn];
      var B = [p.a[0] + p.ux*c.t3 + nx*c.dn, p.a[1] + p.uy*c.t3 + ny*c.dn];
      if (Math.abs(p.ux) > Math.abs(p.uy) ? p.ux < 0 : p.uy < 0){ var tmp = A; A = B; B = tmp; }   // dirección canónica por la componente dominante
      tramos.push({de:A, a:B, esp:c.sep});
    });

    // Unión de tramos colineales (mismo eje ±0,03, mismo espesor ±0,02, hueco ≤ HUECO_MAX)
    var grupos = [];
    tramos.forEach(function(w){
      var L = Math.hypot(w.a[0] - w.de[0], w.a[1] - w.de[1]), ux = (w.a[0] - w.de[0]) / L, uy = (w.a[1] - w.de[1]) / L;
      var g = null;
      for (var k = 0; k < grupos.length && !g; k++){
        var h = grupos[k];
        if (Math.abs(h.ux*uy - h.uy*ux) > SEN || Math.abs(h.esp - w.esp) > 0.02) continue;
        if (Math.abs(-h.uy*w.de[0] + h.ux*w.de[1] - h.c) <= 0.03) g = h;
      }
      if (!g){ g = {ux:ux, uy:uy, esp:w.esp, c:-uy*w.de[0] + ux*w.de[1], m:[]}; grupos.push(g); }
      var ta = g.ux*w.de[0] + g.uy*w.de[1], tb = g.ux*w.a[0] + g.uy*w.a[1];
      g.m.push({t0:Math.min(ta, tb), t1:Math.max(ta, tb), c:-g.uy*w.de[0] + g.ux*w.de[1], esp:w.esp});
    });
    var muros = [];
    grupos.forEach(function(g){
      g.m.sort(function(x, y){ return x.t0 - y.t0; });
      var cadena = null;
      function cerrar(){
        if (!cadena) return;
        muros.push({g:g, c:cadena.cs / cadena.n, esp:cadena.es / cadena.n, t0:cadena.t0, t1:cadena.t1, huecos:cadena.huecos});
        cadena = null;
      }
      g.m.forEach(function(w){
        if (cadena && w.t0 - cadena.t1 <= HUECO_MAX){
          if (w.t0 - cadena.t1 > 0.02) cadena.huecos.push([cadena.t1, w.t0]);
          cadena.t1 = Math.max(cadena.t1, w.t1); cadena.cs += w.c; cadena.es += w.esp; cadena.n++;
        } else { cerrar(); cadena = {t0:w.t0, t1:w.t1, cs:w.c, es:w.esp, n:1, huecos:[]}; }
      });
      cerrar();
    });
    muros.forEach(function(m, k){ m.id = 'D' + (k + 1); });
    function punto(g, c, t){ return [r(g.ux*t - g.uy*c), r(g.uy*t + g.ux*c)]; }

    // Huecos → aberturas propuestas. A cada hueco se le descuenta el espesor de los muros transversales que lo cruzan
    // (un encuentro de muros no es una abertura); lo que queda y mide ≥ ABERTURA_MIN es una abertura.
    var aberturas = [];
    muros.forEach(function(m){
      var g = m.g;
      m.huecos.forEach(function(h){
        var bandas = [];
        muros.forEach(function(o){
          if (o === m || Math.abs(g.ux*o.g.ux + g.uy*o.g.uy) > SEN) return;       // solo transversales (≈ 90°)
          var P = punto(o.g, o.c, o.t0), Q = punto(o.g, o.c, o.t1);
          var d1 = -g.uy*P[0] + g.ux*P[1] - m.c, d2 = -g.uy*Q[0] + g.ux*Q[1] - m.c;
          if (Math.min(d1, d2) > 0.02 || Math.max(d1, d2) < -0.02 || Math.abs(d2 - d1) < 1e-9) return;
          var lam = Math.max(0, Math.min(1, -d1 / (d2 - d1)));
          var t = g.ux*(P[0] + lam*(Q[0] - P[0])) + g.uy*(P[1] + lam*(Q[1] - P[1]));
          if (t >= h[0] - 0.05 && t <= h[1] + 0.05) bandas.push([t - o.esp / 2, t + o.esp / 2]);
        });
        bandas.sort(function(x, y){ return x[0] - y[0]; });
        var partes = [], desde = h[0];
        bandas.forEach(function(bd){ if (bd[0] > desde) partes.push([desde, Math.min(bd[0], h[1])]); desde = Math.max(desde, bd[1]); });
        if (desde < h[1]) partes.push([desde, h[1]]);
        partes.forEach(function(pt){
          var ancho = pt[1] - pt[0];
          if (ancho < ABERTURA_MIN) return;
          var vent = S.some(function(s){
            if (Math.abs(g.ux*s.uy - g.uy*s.ux) > SEN) return false;
            var ta = g.ux*s.a[0] + g.uy*s.a[1], tb = g.ux*s.b[0] + g.uy*s.b[1];
            var ca = -g.uy*s.a[0] + g.ux*s.a[1], cb = -g.uy*s.b[0] + g.ux*s.b[1], tol = m.esp / 2 + 0.02;
            return Math.min(ta, tb) >= pt[0] - 0.02 && Math.max(ta, tb) <= pt[1] + 0.02 &&
                   Math.abs(ca - m.c) <= tol && Math.abs(cb - m.c) <= tol && Math.abs(tb - ta) >= ancho * 0.5;
          });
          aberturas.push({id:'DA' + (aberturas.length + 1), muro:m.id, desde:r(pt[0] - m.t0), ancho:r(ancho),
            alto:vent ? 1.10 : 2.10, tipo:vent ? 'ventana_corrediza' : 'puerta', propuesto:true});
        });
      });
    });

    // Exterior: el eje corre a menos de esp + 0,05 m del borde del rectángulo envolvente (Mo.enContorno)
    var res = muros.map(function(m){
      return {id:m.id, de:punto(m.g, m.c, m.t0), a:punto(m.g, m.c, m.t1), esp:r(m.esp), tipo:'interior', propuesto:true};
    });
    Mo.enContorno(res).forEach(function(si, k){ if (si) res[k].tipo = 'exterior'; });
    return {muros:res, aberturas:aberturas};
  }
  function detectarMuros(segmentos){ return detectarPlano(segmentos).muros; }

  var api = {leerDxf:leerDxf, detectarMuros:detectarMuros, detectarPlano:detectarPlano};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FugaDxf = api;
})(typeof self !== 'undefined' ? self : this);
