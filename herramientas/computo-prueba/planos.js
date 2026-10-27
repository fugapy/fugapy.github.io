// Detección de muros y aberturas para la demo «Cómputo desde plano»: rápida (índice de grilla) y sin confiar en los nombres de capa.
// elegirUnidad(segmentos, declarada) → {unidad, escala, motivo, pares}. «segmentos» en unidades del archivo (los de lector.aplanar).
//   Prueba m, cm y mm: gana la que da más pares de líneas paralelas de 0,5 m o más separadas 0,10 a 0,30 m (pares = {m, cm, mm}).
//   Empate: la declarada; si no está entre las empatadas, la de extensión razonable, como antes. motivo: 'pares' | 'declarada' | 'extension'.
// origen(segmentos) → [x0, y0]: esquina inferior izquierda redondeada hacia abajo. Se resta antes de calcular y se suma al final,
//   así no se pierde precisión con coordenadas georreferenciadas (del orden de 7.000.000).
// puntajeCapas(segmentos) → {capa: puntaje}: longitud en pares de muro / longitud total, +0,3 si el nombre parece de muros,
//   −0,3 si parece de cotas, ejes, mobiliario, rótulos… El nombre solo suma o resta: ninguna capa se descarta por su nombre.
//   Los pares se cuentan entre líneas de la misma capa, y no cuentan las líneas calcadas sobre las de una capa más fuerte.
// detectarPlano(segmentosEnMetros, opts) → {muros, aberturas, avisos}: muros con el formato de Modelo ({id,de,a,esp,tipo,propuesto})
//   y aberturas propuestas ({id,muro,desde,ancho,alto,tipo,propuesto}).
//   - Pares de líneas paralelas → tramos de muro; los tramos colineales se unen y cada hueco queda como abertura propuesta
//     (puerta, o ventana corrediza si hay líneas dentro del hueco).
//   - Se descartan las capas con puntaje < 0,15 solo si las de puntaje ≥ 0,4 juntan el 60 % de la longitud en pares.
//   - Un segmento de 0,5 m o más con ancho de 0,08 a 0,35 m (polilínea con ancho) es un muro de ese espesor sobre su eje.
//   - Marcos, umbrales y hojas de aberturas (tramos más finos dentro de la banda de un muro más grueso y dentro de su largo)
//     no son muros ni se promedian con él; sus líneas solo sirven para reconocer ventanas.
//   - opts.unaLinea: en capas con nombre de muro y sin pares, cada segmento de 0,5 m o más es un muro de 0,15 (aviso 'una_linea').
// Grilla(celda): índice espacial de segmentos. agregar(id, a, b); lista(a, b, margen) → ids de los segmentos que pasan a menos de
//   «margen» (por defecto una celda) del segmento a-b, sin repetir y quizá alguno más lejano; cerca(a, b, fn, margen) llama fn(id)
//   con cada uno. Los segmentos demasiado largos para la grilla se devuelven siempre.
// analizar(aplanado, opts) → {unidad, escala, origen, dibujos, fondo, avisos}: unidad, muros y después dibujos.js separa el archivo en dibujos
//   (grupos de muros cercanos), les pone puntaje de planta, une los repetidos y los ordena. Detalle en el comentario de analizar, más abajo.
// Funciona en Node, en la página y dentro de un Web Worker (se cuelga de self). Necesita modelo.js (enContorno) y dibujos.js.
(function(root){
  'use strict';
  var nodo = typeof module !== 'undefined' && module.exports;
  var Mo = nodo ? require('./modelo.js') : null;
  function modelo(){ return Mo || root.FugaModelo; }   // en el navegador modelo.js puede cargarse después que este archivo
  function dibujos(){ return nodo ? require('./dibujos.js') : root.FugaDibujos; }   // se pide al usarlo: dibujos.js usa la Grilla de acá

  var ESCALA = {m:1, cm:0.01, mm:0.001}, UNIDADES = ['m', 'cm', 'mm'];
  var ESP_MIN = 0.10, ESP_MAX = 0.30;   // separación de la doble línea (m)
  var SOLAPE_MIN = 0.50;                // tramo mínimo en común (m)
  var SEN = Math.sin(2 * Math.PI / 180);// paralelismo: 2°
  var REUSO_MAX = 0.05;                 // un segmento puede entrar en varios pares si los tramos no se pisan más que esto
  var HUECO_MAX = 2.50;                 // hueco máximo entre tramos colineales que se une en un solo muro
  var ABERTURA_MIN = 0.40;              // un hueco más corto es un encuentro de muros, no una abertura
  var PLANO_MIN = 3, PLANO_MAX = 2000;  // lado mayor razonable de una planta (m) con la unidad declarada
  var LARGO_MIN = 0.50;                 // segmentos que cuentan para elegir la unidad y para los muros de una línea
  var ANCHO_MIN = 0.08, ANCHO_MAX = 0.35, ESP_UNA_LINEA = 0.15;
  var EPS = 1e-6;                       // tolerancia de los umbrales (1 µm): coordenadas de 7e6 traen ruido de 1e-9
  var ESP_DIF = 0.02;                   // un tramo al menos esto más fino, dentro de la banda de un muro, es marco o umbral
  var DUP_MAX = 0.01;                   // dos líneas a menos de esto, una encima de la otra, son un calco
  var CELDA = 1;                        // celda de la grilla (m)
  var DESVIO = 0.018;                   // ≥ tan 2° / 2: lo que se aparta una paralela de 2°, por metro de largo, desde su centro
  var NOMBRE_MURO = /MURO|MAMPOS|PARED|WALL|TABIQ/i;
  var NOMBRE_OTRO = /COTA|DIM|TEXT|EJE|MOBIL|EQUIP|SANIT|R[OÓ]TULO|MARCO|RECUADRE|HATCH|RELLENO|DEFPOINTS/i;
  var BONO_NOMBRE = 0.3, PUNTAJE_BAJO = 0.15, PUNTAJE_ALTO = 0.4, PARTE_ALTA = 0.6;

  function r(v){ return Math.round(v * 1e4) / 1e4; }

  // ---------- grilla ----------
  var MAX_CELDAS = 4096, LIM = 16777216;   // un segmento que toca más celdas que esto va a la lista de largos
  var CHICA = 16384;                       // con |i|, |j| < CHICA la clave es un entero chico (más rápido en Map)
  function clave(i, j){
    return i > -CHICA && i < CHICA && j > -CHICA && j < CHICA ? (i + CHICA) * 32768 + (j + CHICA) : 1125899906842624 + (i + LIM) * 33554432 + (j + LIM);
  }
  // Todas las celdas que tocan los puntos a menos de m del segmento a-b (recorre columnas del eje dominante).
  // Con m = 0 son las celdas que cruza el segmento. false si son demasiadas.
  function celdas(a, b, c, m, fn){
    var x0 = a[0] / c, y0 = a[1] / c, x1 = b[0] / c, y1 = b[1] / c, t, swap = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    if (swap){ t = x0; x0 = y0; y0 = t; t = x1; x1 = y1; y1 = t; }
    if (x0 > x1){ t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }
    var e = m / c, i0 = Math.floor(x0 - e), i1 = Math.floor(x1 + e), lim = LIM - 2;
    if (!(Math.abs(x0) < lim && Math.abs(x1) < lim && Math.abs(y0) < lim && Math.abs(y1) < lim) || i1 - i0 > MAX_CELDAS) return false;
    var pend = x1 > x0 ? (y1 - y0) / (x1 - x0) : 0;
    for (var i = i0; i <= i1; i++){
      var xa = Math.min(Math.max(i - e, x0), x1), xb = Math.max(Math.min(i + 1 + e, x1), x0);
      var ya = y0 + pend * (xa - x0), yb = y0 + pend * (xb - x0);
      for (var j = Math.floor(Math.min(ya, yb) - e), j1 = Math.floor(Math.max(ya, yb) + e); j <= j1; j++){ if (swap) fn(j, i); else fn(i, j); }
    }
    return true;
  }
  function Grilla(celda){ this.c = celda; this.m = new Map(); this.largos = []; this.todos = []; this.marca = []; this.vez = 0; }
  Grilla.prototype.agregar = function(id, a, b){
    var m = this.m;
    if (!celdas(a, b, this.c, 0, function(i, j){ var k = clave(i, j), l = m.get(k); if (l) l.push(id); else m.set(k, [id]); })) this.largos.push(id);
    this.todos.push(id);
  };
  // fn(id) una vez por cada segmento que pasa a menos de «margen» del segmento a-b (por defecto, una celda); puede traer alguno más lejano.
  Grilla.prototype.lista = function(a, b, margen){
    var m = this.m, marca = this.marca, vez = ++this.vez, out = [];
    function ver(l){ for (var q = 0; q < l.length; q++){ var id = l[q]; if (marca[id] !== vez){ marca[id] = vez; out.push(id); } } }
    var ok = celdas(a, b, this.c, margen == null ? this.c : margen, function(i, j){ var l = m.get(clave(i, j)); if (l) ver(l); });
    ver(ok ? this.largos : this.todos);
    return out;
  };
  Grilla.prototype.cerca = function(a, b, fn, margen){ this.lista(a, b, margen).forEach(function(id){ fn(id); }); };

  // ---------- segmentos ----------
  function origen(segmentos){
    var x0 = Infinity, y0 = Infinity;
    (segmentos || []).forEach(function(s){
      if (!s || !s.a || !s.b) return;
      [s.a, s.b].forEach(function(p){ if (isFinite(p[0]) && isFinite(p[1])){ x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); } });
    });
    // redondeado a 1e-6 antes de bajar: 599,999999999998 (ruido del DXF exportado) y 600 dan el mismo origen
    return isFinite(x0) ? [Math.floor(Math.round(x0 * 1e6) / 1e6), Math.floor(Math.round(y0 * 1e6) / 1e6)] : [0, 0];
  }
  // Segmentos locales (origen restado, escala k) con longitud y dirección; se saltan los degenerados y los no finitos.
  function preparar(segmentos, o, k){
    var S = [];
    (segmentos || []).forEach(function(s){
      if (!s || !s.a || !s.b) return;
      var a = [(s.a[0] - o[0]) * k, (s.a[1] - o[1]) * k], b = [(s.b[0] - o[0]) * k, (s.b[1] - o[1]) * k];
      var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (!(L >= 1e-6) || !isFinite(L + a[0] + a[1])) return;
      S.push({a:a, b:b, L:L, ux:dx / L, uy:dy / L, capa:String(s.capa == null ? '' : s.capa), ancho:s.ancho == null ? null : s.ancho * k});
    });
    return S;
  }

  // ---------- pares de líneas paralelas ----------
  function par(p, q){
    if (Math.abs(p.ux*q.uy - p.uy*q.ux) > SEN) return null;
    var nx = -p.uy, ny = p.ux;   // marco de p: t a lo largo, n transversal
    var d1 = (q.a[0] - p.a[0])*nx + (q.a[1] - p.a[1])*ny, d2 = (q.b[0] - p.a[0])*nx + (q.b[1] - p.a[1])*ny;
    var sep = Math.abs((d1 + d2) / 2);
    if (sep < ESP_MIN - EPS || sep > ESP_MAX + EPS) return null;
    var t1 = (q.a[0] - p.a[0])*p.ux + (q.a[1] - p.a[1])*p.uy, t2 = (q.b[0] - p.a[0])*p.ux + (q.b[1] - p.a[1])*p.uy;
    var t0 = Math.max(0, Math.min(t1, t2)), t3 = Math.min(p.L, Math.max(t1, t2));
    if (t3 - t0 < SOLAPE_MIN - EPS) return null;
    return {sep:sep, t0:t0, t3:t3, dn:(d1 + d2) / 4};   // dn = desplazamiento del eje medio respecto de p
  }
  // Todos los pares candidatos, por separación y, a igual separación, por (i, j), como el detectarPlano de antes.
  // Cada par se mira una vez, desde el segmento más largo, buscando a ESP_MAX + la desviación que permite el paralelismo.
  // Con «dups», junta también las líneas de capas distintas que se pisan (paralelas a ≤ DUP_MAX, con tramo en común).
  function candidatos(S, grilla, dups){
    var cand = [];
    S.forEach(function(s, i){ grilla.agregar(i, s.a, s.b); });
    S.forEach(function(s, i){
      var cerca = grilla.lista(s.a, s.b, ESP_MAX + DUP_MAX + DESVIO * s.L);
      for (var k = 0; k < cerca.length; k++){
        var j = cerca[k], o = S[j];
        if (j === i || o.L > s.L || (o.L === s.L && j < i)) continue;
        var i0 = Math.min(i, j), j0 = Math.max(i, j), p = S[i0], q = S[j0], c = par(p, q);
        if (c){ c.i = i0; c.j = j0; cand.push(c); }
        else if (dups && p.capa !== q.capa && Math.abs(p.ux*q.uy - p.uy*q.ux) <= SEN){
          var nx = -p.uy, ny = p.ux, d1 = (q.a[0] - p.a[0])*nx + (q.a[1] - p.a[1])*ny, d2 = (q.b[0] - p.a[0])*nx + (q.b[1] - p.a[1])*ny;
          if (Math.abs(d1) > DUP_MAX || Math.abs(d2) > DUP_MAX) continue;
          var t1 = (q.a[0] - p.a[0])*p.ux + (q.a[1] - p.a[1])*p.uy, t2 = (q.b[0] - p.a[0])*p.ux + (q.b[1] - p.a[1])*p.uy;
          var l = Math.min(p.L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2));
          if (l > 0) dups.push({i:i0, j:j0, l:l});
        }
      }
    });
    // la separación se compara redondeada a 1 µm: el ruido de las coordenadas no cambia el orden de pares iguales
    cand.forEach(function(c){ c.orden = Math.round(c.sep / EPS); });
    return cand.sort(function(x, y){ return x.orden - y.orden || x.i - y.i || x.j - y.j; });
  }

  // ---------- unidad ----------
  function porExtension(segmentos, declarada){
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0;   // en bucle: Math.max.apply revienta con ~100.000 argumentos
    (segmentos || []).forEach(function(s){
      if (!s || !s.a || !s.b) return;
      [s.a, s.b].forEach(function(p){
        if (!isFinite(p[0]) || !isFinite(p[1])) return;
        n++; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
      });
    });
    var ext = n ? Math.max(x1 - x0, y1 - y0) : 0, u = declarada;
    // Sin unidad, o con una que deja la planta de menos de 3 m o más de 2 km: se adivina por la extensión mayor
    if (!u || (n && (ext * ESCALA[u] < PLANO_MIN || ext * ESCALA[u] > PLANO_MAX))) u = ext > 1000 ? 'mm' : ext > 100 ? 'cm' : 'm';
    return u;
  }
  function elegirUnidad(segmentos, declarada){
    declarada = ESCALA[declarada] ? declarada : null;
    var o = origen(segmentos), pares = {}, mejor = 0;
    UNIDADES.forEach(function(u){
      var S = preparar(segmentos, o, ESCALA[u]).filter(function(s){ return s.L >= LARGO_MIN; });
      var largo = S.reduce(function(t, s){ return t + s.L; }, 0) / (S.length || 1);   // celda ≈ largo medio: pocas celdas por segmento en cualquier unidad
      pares[u] = S.length > 1 ? candidatos(S, new Grilla(Math.max(CELDA, largo))).length : 0;
      mejor = Math.max(mejor, pares[u]);
    });
    var empate = UNIDADES.filter(function(u){ return pares[u] === mejor; }), ext = porExtension(segmentos, declarada), u, motivo;
    if (mejor && empate.length === 1){ u = empate[0]; motivo = 'pares'; }
    else if (mejor && declarada && empate.indexOf(declarada) >= 0){ u = declarada; motivo = 'declarada'; }
    else { u = !mejor || empate.indexOf(ext) >= 0 ? ext : empate[0]; motivo = 'extension'; }
    return {unidad:u, escala:ESCALA[u], motivo:motivo, pares:pares};
  }

  // ---------- capas ----------
  // Una capa es «de muros» si buena parte de su longitud forma pares de muro con líneas de la misma capa (un muro tiene sus dos
  // caras en la misma capa). Las líneas que repiten otra línea (contornos de ambientes, ejes o lote calcados sobre las caras
  // de los muros) no cuentan: el calco se le descuenta a la capa más débil. Las polilíneas con ancho de muro cuentan enteras.
  function medirCapas(S, A, cand, dups){
    var capas = Object.create(null);   // sin prototipo: una capa puede llamarse __proto__
    function capa(n){ return capas[n] || (capas[n] = {total:0, pares:0, base:0}); }
    function nombre(n){ return (NOMBRE_MURO.test(n) ? BONO_NOMBRE : 0) - (NOMBRE_OTRO.test(n) ? BONO_NOMBRE : 0); }
    function cubrir(ok){
      var cub = S.map(function(){ return 0; });
      cand.forEach(function(c){ if (S[c.i].capa === S[c.j].capa && ok(c)){ cub[c.i] += c.t3 - c.t0; cub[c.j] += c.t3 - c.t0; } });
      return cub;
    }
    var cub = cubrir(function(){ return true; });
    S.forEach(function(s, i){ var k = capa(s.capa); k.total += s.L; k.base += Math.min(s.L, cub[i]); });
    A.forEach(function(s){ var k = capa(s.capa); k.total += s.L; k.base += s.L; k.pares += s.L; });
    Object.keys(capas).forEach(function(n){ capas[n].base = capas[n].base / capas[n].total + nombre(n); });
    var dup = S.map(function(){ return 0; });
    dups.forEach(function(d){
      var bi = capas[S[d.i].capa].base, bj = capas[S[d.j].capa].base;
      if (bi < bj) dup[d.i] += d.l; else if (bj < bi) dup[d.j] += d.l;
    });
    function calco(k){ return dup[k] >= 0.5 * S[k].L; }
    cub = cubrir(function(c){ return !calco(c.i) && !calco(c.j); });
    S.forEach(function(s, i){ capas[s.capa].pares += Math.max(0, Math.min(s.L, cub[i]) - dup[i]); });
    Object.keys(capas).forEach(function(n){ var k = capas[n]; k.puntaje = k.pares / k.total + nombre(n); });
    return capas;
  }
  // Se descartan las capas flojas solo si las fuertes juntan la mayor parte de la longitud en pares; si no, ninguna.
  function descartadas(capas){
    var total = 0, alto = 0, fuera = Object.create(null);
    Object.keys(capas).forEach(function(n){ total += capas[n].pares; if (capas[n].puntaje >= PUNTAJE_ALTO) alto += capas[n].pares; });
    if (total > 0 && alto >= PARTE_ALTA * total)
      Object.keys(capas).forEach(function(n){ if (capas[n].puntaje < PUNTAJE_BAJO) fuera[n] = true; });
    return fuera;
  }
  function separar(segmentos, o){
    var T = preparar(segmentos, o, 1), S = [], A = [];
    T.forEach(function(s){ (s.ancho >= ANCHO_MIN && s.ancho <= ANCHO_MAX && s.L >= LARGO_MIN ? A : S).push(s); });
    return {S:S, A:A};
  }
  function puntajeCapas(segmentos){
    var t = separar(segmentos, origen(segmentos)), dups = [], cand = candidatos(t.S, new Grilla(CELDA), dups), capas = medirCapas(t.S, t.A, cand, dups), out = {};
    Object.keys(capas).forEach(function(n){ Object.defineProperty(out, n, {value:capas[n].puntaje, enumerable:true, writable:true, configurable:true}); });
    return out;
  }

  // ---------- unión de tramos colineales ----------
  // Mismo eje (±0,03), mismo espesor (±0,02) y paralelos: el tramo va al primer grupo que cumple, como siempre.
  // Índice por ángulo fino (ANG_Q) y por desplazamiento medido con la dirección de cada casillero.
  var ANG_Q = 1e-4, ANG_GRUESO = Math.PI / 180, N_ANG = Math.round(Math.PI / ANG_Q), N_GRUESO = 180;
  function angulo(ux, uy){ var t = Math.atan2(uy, ux); return t < 0 ? t + Math.PI : t; }
  function agrupar(tramos){
    var x1 = 0, y1 = 0, x0 = 0, y0 = 0;
    tramos.forEach(function(w){ [w.de, w.a].forEach(function(p){ x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); });
    var ven = 0.03 + Math.hypot(x1 - x0, y1 - y0) * Math.sin(ANG_Q / 2) + 1e-6, paso = Math.max(0.1, 2 * ven);
    var abre = Math.asin(SEN) + ANG_Q, grupos = [], casilleros = new Map(), gruesos = new Map();
    function despl(b, p){ var t = b * ANG_Q; return -Math.sin(t) * p[0] + Math.cos(t) * p[1]; }
    tramos.forEach(function(w){
      var L = Math.hypot(w.a[0] - w.de[0], w.a[1] - w.de[1]), ux = (w.a[0] - w.de[0]) / L, uy = (w.a[1] - w.de[1]) / L;
      var th = angulo(ux, uy), g = null;
      for (var k = Math.floor((th - abre) / ANG_GRUESO); k <= Math.floor((th + abre) / ANG_GRUESO); k++){
        (gruesos.get((k % N_GRUESO + N_GRUESO) % N_GRUESO) || []).forEach(function(b){
          var d = Math.abs(b * ANG_Q - th) % Math.PI;
          if (Math.min(d, Math.PI - d) > abre) return;
          var cas = casilleros.get(b), c = despl(b, w.de);
          for (var q = Math.floor((c - ven) / paso); q <= Math.floor((c + ven) / paso); q++) (cas.get(q) || []).forEach(function(h){
            if (g && g.n < h.n) return;
            if (Math.abs(h.ux*uy - h.uy*ux) > SEN || Math.abs(h.esp - w.esp) > 0.02 + EPS) return;
            if (Math.abs(-h.uy*w.de[0] + h.ux*w.de[1] - h.c) <= 0.03 + EPS) g = h;
          });
        });
      }
      if (!g){
        g = {n:grupos.length, ux:ux, uy:uy, esp:w.esp, c:-uy*w.de[0] + ux*w.de[1], m:[]};
        grupos.push(g);
        var b = Math.round(th / ANG_Q) % N_ANG, kg = Math.floor(b * ANG_Q / ANG_GRUESO) % N_GRUESO, q = Math.floor(despl(b, w.de) / paso);
        if (!casilleros.has(b)){ casilleros.set(b, new Map()); (gruesos.get(kg) || gruesos.set(kg, []).get(kg)).push(b); }
        var cas = casilleros.get(b);
        (cas.get(q) || cas.set(q, []).get(q)).push(g);
      }
      var ta = g.ux*w.de[0] + g.uy*w.de[1], tb = g.ux*w.a[0] + g.uy*w.a[1];
      g.m.push({t0:Math.min(ta, tb), t1:Math.max(ta, tb), c:-g.uy*w.de[0] + g.ux*w.de[1], esp:w.esp});
    });
    return grupos;
  }

  // Cadenas de tramos colineales con huecos ≤ HUECO_MAX; cada hueco se recuerda para proponer aberturas.
  function cadenas(tramos){
    var muros = [];
    agrupar(tramos).forEach(function(g){
      g.m.sort(function(x, y){ return x.t0 - y.t0; });
      var cad = null;
      function cerrar(){
        if (!cad) return;
        muros.push({g:g, c:cad.cs / cad.n, esp:cad.es / cad.n, t0:cad.t0, t1:cad.t1, huecos:cad.huecos});
        cad = null;
      }
      g.m.forEach(function(w){
        if (cad && w.t0 - cad.t1 <= HUECO_MAX + EPS){
          if (w.t0 - cad.t1 > 0.02 + EPS) cad.huecos.push([cad.t1, w.t0]);
          cad.t1 = Math.max(cad.t1, w.t1); cad.cs += w.c; cad.es += w.esp; cad.n++;
        } else { cerrar(); cad = {t0:w.t0, t1:w.t1, cs:w.c, es:w.esp, n:1, huecos:[]}; }
      });
      cerrar();
    });
    return muros;
  }
  function direccion(w){ var L = Math.hypot(w.a[0] - w.de[0], w.a[1] - w.de[1]); return [(w.a[0] - w.de[0]) / L, (w.a[1] - w.de[1]) / L]; }
  // ¿El tramo f es paralelo, al menos ESP_DIF más fino y corre dentro de la banda del eje (u, c, esp)? Devuelve su tramo [t0, t1].
  function enBanda(f, u, c, esp){
    var v = direccion(f);
    if (Math.abs(u[0]*v[1] - u[1]*v[0]) > SEN || esp < f.esp + ESP_DIF - EPS) return null;
    if (![f.de, f.a].every(function(p){ return Math.abs(-u[1]*p[0] + u[0]*p[1] - c) < esp / 2; })) return null;
    var ta = u[0]*f.de[0] + u[1]*f.de[1], tb = u[0]*f.a[0] + u[1]*f.a[1];
    return [Math.min(ta, tb), Math.max(ta, tb)];
  }
  // Marcos, umbrales y hojas de las aberturas (bloques explotados): tramos al menos ESP_DIF más finos que corren dentro de la
  // banda de un muro más grueso, dentro de su largo (huecos incluidos) o entre dos tramos de muro del mismo eje.
  // No son muros y no se promedian con el muro: se sacan; sus líneas siguen sirviendo para reconocer ventanas.
  // 1) candidatos: un tramo más grueso y paralelo los contiene en su banda, a ≤ HUECO_MAX a lo largo;
  // 2) se arman los muros sin los candidatos; 3) se saca el candidato cubierto por muros por los dos lados; los demás vuelven.
  function sinMarcos(tramos){
    var g = new Grilla(CELDA), H = 0.05;
    tramos.forEach(function(w, k){ g.agregar(k, w.de, w.a); });
    var cand = tramos.map(function(f){
      return g.lista(f.de, f.a, HUECO_MAX + ESP_MAX).some(function(j){
        var h = tramos[j], u = direccion(h), t = h !== f && enBanda(f, u, -u[1]*h.de[0] + u[0]*h.de[1], h.esp);
        if (!t) return false;
        var th0 = u[0]*h.de[0] + u[1]*h.de[1], th1 = u[0]*h.a[0] + u[1]*h.a[1];
        return t[0] <= Math.max(th0, th1) + HUECO_MAX && t[1] >= Math.min(th0, th1) - HUECO_MAX;
      });
    });
    if (cand.indexOf(true) < 0) return tramos;
    var muros = cadenas(tramos.filter(function(w, k){ return !cand[k]; })), gM = new Grilla(CELDA);
    muros.forEach(function(m, k){ var g0 = m.g; gM.agregar(k, [g0.ux*m.t0 - g0.uy*m.c, g0.uy*m.t0 + g0.ux*m.c], [g0.ux*m.t1 - g0.uy*m.c, g0.uy*m.t1 + g0.ux*m.c]); });
    return tramos.filter(function(f, k){
      if (!cand[k]) return true;
      var antes = false, despues = false;
      gM.lista(f.de, f.a, HUECO_MAX + ESP_MAX).forEach(function(j){
        var m = muros[j], t = enBanda(f, [m.g.ux, m.g.uy], m.c, m.esp);
        if (t){ antes = antes || m.t0 <= t[0] + H; despues = despues || m.t1 >= t[1] - H; }
      });
      return !(antes && despues);
    });
  }

  // ---------- detección ----------
  function tramo(A, B, esp){
    var dx = B[0] - A[0], dy = B[1] - A[1];
    if (Math.abs(dx) > Math.abs(dy) ? dx < 0 : dy < 0){ var t = A; A = B; B = t; }   // dirección canónica por la componente dominante
    return {de:A, a:B, esp:esp};
  }
  function detectarPlano(segmentos, opts){
    opts = opts || {};
    var o = origen(segmentos), t = separar(segmentos, o), S = t.S, avisos = [];
    var gS = new Grilla(CELDA), dups = [], cand = candidatos(S, gS, dups), capas = medirCapas(S, t.A, cand, dups), fuera = descartadas(capas);
    var vale = S.map(function(s){ return !fuera[s.capa]; });

    // Un segmento puede entrar en varios pares si los tramos usados no se pisan más de REUSO_MAX.
    var usos = S.map(function(){ return null; }), tramos = [];
    function libre(k, i0, i1){
      return !usos[k] || usos[k].every(function(u){ return Math.min(u[1], i1) - Math.max(u[0], i0) <= REUSO_MAX + EPS; });
    }
    function usar(k, i0, i1){ (usos[k] || (usos[k] = [])).push([i0, i1]); }
    cand.forEach(function(c){
      if (!vale[c.i] || !vale[c.j]) return;
      var p = S[c.i], q = S[c.j];
      var tq0 = (p.a[0] + p.ux*c.t0 - q.a[0])*q.ux + (p.a[1] + p.uy*c.t0 - q.a[1])*q.uy;
      var tq1 = (p.a[0] + p.ux*c.t3 - q.a[0])*q.ux + (p.a[1] + p.uy*c.t3 - q.a[1])*q.uy;
      var q0 = Math.min(tq0, tq1), q1 = Math.max(tq0, tq1);
      if (!libre(c.i, c.t0, c.t3) || !libre(c.j, q0, q1)) return;
      usar(c.i, c.t0, c.t3); usar(c.j, q0, q1);
      var nx = -p.uy, ny = p.ux;
      tramos.push(tramo([p.a[0] + p.ux*c.t0 + nx*c.dn, p.a[1] + p.uy*c.t0 + ny*c.dn],
                        [p.a[0] + p.ux*c.t3 + nx*c.dn, p.a[1] + p.uy*c.t3 + ny*c.dn], c.sep));
    });
    t.A.forEach(function(s){ if (!fuera[s.capa]) tramos.push(tramo(s.a, s.b, s.ancho)); });   // polilíneas con ancho de muro
    if (opts.unaLinea) S.forEach(function(s){
      var k = capas[s.capa];
      if (!fuera[s.capa] && NOMBRE_MURO.test(s.capa) && k.pares === 0 && s.L >= LARGO_MIN){
        tramos.push(tramo(s.a, s.b, ESP_UNA_LINEA));
        if (avisos.indexOf('una_linea') < 0) avisos.push('una_linea');
      }
    });

    var muros = cadenas(sinMarcos(tramos));
    function punto(g, c, tt){ return [g.ux*tt - g.uy*c, g.uy*tt + g.ux*c]; }
    var gM = new Grilla(CELDA);
    muros.forEach(function(m, k){
      m.id = 'D' + (k + 1);
      m.P = punto(m.g, m.c, m.t0).map(r); m.Q = punto(m.g, m.c, m.t1).map(r);
      gM.agregar(k, m.P, m.Q);
    });

    // Huecos → aberturas propuestas. A cada hueco se le descuenta el espesor de los muros transversales que lo cruzan
    // (un encuentro de muros no es una abertura); lo que queda y mide ≥ ABERTURA_MIN es una abertura.
    var aberturas = [];
    muros.forEach(function(m){
      var g = m.g;
      m.huecos.forEach(function(h){
        var bandas = [];
        gM.cerca(punto(g, m.c, h[0] - 0.05), punto(g, m.c, h[1] + 0.05), function(k){
          var w = muros[k];
          if (w === m || Math.abs(g.ux*w.g.ux + g.uy*w.g.uy) > SEN) return;       // solo transversales (≈ 90°)
          var P = w.P, Q = w.Q;
          var d1 = -g.uy*P[0] + g.ux*P[1] - m.c, d2 = -g.uy*Q[0] + g.ux*Q[1] - m.c;
          if (Math.min(d1, d2) > 0.02 + EPS || Math.max(d1, d2) < -0.02 - EPS || Math.abs(d2 - d1) < 1e-9) return;
          var lam = Math.max(0, Math.min(1, -d1 / (d2 - d1)));
          var tt = g.ux*(P[0] + lam*(Q[0] - P[0])) + g.uy*(P[1] + lam*(Q[1] - P[1]));
          if (tt >= h[0] - 0.05 - EPS && tt <= h[1] + 0.05 + EPS) bandas.push([tt - w.esp / 2, tt + w.esp / 2]);
        }, 0.05);
        bandas.sort(function(x, y){ return x[0] - y[0]; });
        var partes = [], desde = h[0];
        bandas.forEach(function(bd){ if (bd[0] > desde) partes.push([desde, Math.min(bd[0], h[1])]); desde = Math.max(desde, bd[1]); });
        if (desde < h[1]) partes.push([desde, h[1]]);
        partes.forEach(function(pt){
          var ancho = pt[1] - pt[0], vent = false;
          if (ancho < ABERTURA_MIN - EPS) return;
          gS.cerca(punto(g, m.c, pt[0] - 0.02), punto(g, m.c, pt[1] + 0.02), function(k){
            var s = S[k];
            if (vent || !vale[k] || Math.abs(g.ux*s.uy - g.uy*s.ux) > SEN) return;
            var ta = g.ux*s.a[0] + g.uy*s.a[1], tb = g.ux*s.b[0] + g.uy*s.b[1];
            var ca = -g.uy*s.a[0] + g.ux*s.a[1], cb = -g.uy*s.b[0] + g.ux*s.b[1], tol = m.esp / 2 + 0.02;
            vent = Math.min(ta, tb) >= pt[0] - 0.02 - EPS && Math.max(ta, tb) <= pt[1] + 0.02 + EPS &&
                   Math.abs(ca - m.c) <= tol + EPS && Math.abs(cb - m.c) <= tol + EPS && Math.abs(tb - ta) >= ancho * 0.5 - EPS;
          }, m.esp / 2 + 0.05);
          aberturas.push({id:'DA' + (aberturas.length + 1), muro:m.id, desde:r(pt[0] - m.t0), ancho:r(ancho),
            alto:vent ? 1.10 : 2.10, tipo:vent ? 'ventana_corrediza' : 'puerta', propuesto:true});
        });
      });
    });

    // Exterior: el eje corre a menos de esp + 0,05 m del borde del rectángulo envolvente (Mo.enContorno)
    function global(p){ return [r(p[0] + o[0]), r(p[1] + o[1])]; }
    var res = muros.map(function(m){ return {id:m.id, de:global(m.P), a:global(m.Q), esp:r(m.esp), tipo:'interior', propuesto:true}; });
    modelo().enContorno(res).forEach(function(si, k){ if (si) res[k].tipo = 'exterior'; });
    return {muros:res, aberturas:aberturas, avisos:avisos};
  }

  // ---------- analizar: el archivo entero (los dibujos se separan en dibujos.js) ----------
  function lista(v){ return Array.isArray(v) ? v : []; }
  function fin2(p){ return !!p && isFinite(p[0]) && isFinite(p[1]); }
  // analizar(aplanado, {declarada, unidad?, onProgreso?, unaLinea?, debug?}) → {unidad, escala, origen, dibujos, fondo, avisos, debug?}.
  //   Nunca tira excepción. «aplanado» es la salida de lector.aplanar (unidades del archivo). Si viene opts.unidad ('m'|'cm'|'mm') se
  //   fuerza; si no, elegirUnidad. El resultado no depende del orden de las entidades (orden canónico y coordenadas a 1 nm).
  //   Todas las coordenadas de salida (caja, fondo, muros) están en metros, en el marco local del archivo:
  //   (punto del archivo − origen) × escala, con origen = origen(segmentos) en unidades del archivo (precisión con 7.000.000).
  //   Dibujo = {id, caja:[x0,y0,x1,y1], muros, aberturas, fondo:[{a,b}], puntaje, esPlanta, etiqueta, repeticiones, ids, cajas}
  //   (fondo: las líneas a ≤ 0,5 m de la caja y las que llegan a 3 m sin ser de otro dibujo; como mucho FONDO_MAX, las más largas)
  //   (dibujos.js; con opts.debug, también senales: direcciones, puertas, huella, textos que sumaron o restaron):
  //   - grupos de muros cuyas cajas quedan a menos de UNE; se descartan los de menos de 3 muros o 6 m de muro;
  //   - textos y arcos van al dibujo que los contiene o al más cercano a ≤ 3 m (a igual distancia, al más chico); un título que queda
  //     debajo de un dibujo, dentro de su ancho (el punto del texto puede caer hasta 3 m a la izquierda: es su comienzo), va a ese
  //     dibujo hasta a 5 m, salvo que esté pegado a otro dibujo (≤ 1 m y a menos de la mitad). Un marco de lámina (contiene otros dibujos y todos sus
  //     muros van por el borde de su caja) solo se queda con lo que no reclama ningún otro y nunca es planta;
  //   - puntaje por PESOS; esPlanta = puntaje ≥ PESOS.minimo, huella de 15 a 2.000 m², 4 muros o más y no es marco;
  //   - iguales (caja ±2 % y largo de muros ±5 %) se muestran una vez: queda el de mayor puntaje; ids y cajas = los grupos unidos;
  //   - etiqueta: el título que quedó debajo del dibujo o, si no hay, el texto de planta, corte, fachada… más cerca del centro del
  //     borde inferior de la caja; o null;
  //   - orden: plantas primero, después por puntaje de mayor a menor; a igual puntaje, la que aparece en más láminas y después la que
  //     tiene más puertas.
  //   fondo: las líneas del archivo entero ({a, b}, como mucho FONDO_MAX, las más largas), aunque no haya dibujos: la pantalla las
  //   pone de fondo para calcar a mano cuando no hay muros o cuando se elige «Ninguna, la dibujo a mano».
  //   avisos: 'sin_muros' (ningún dibujo), 'error' (falla inesperada: dibujos vacío y debug.error con el detalle), 'una_linea'.
  //   onProgreso(etapa, fracción) con etapa 'unidad' | 'muros' | 'dibujos'.
  function analizar(aplanado, opts){
    opts = opts || {};
    var out = {unidad:null, escala:null, origen:[0, 0], dibujos:[], fondo:[], avisos:[]};
    function progreso(e, f){ try { if (typeof opts.onProgreso === 'function') opts.onProgreso(e, f); } catch (err) {} }
    try {
      var ap = aplanado || {}, segs = lista(ap.segmentos);
      progreso('unidad', 0);
      var u = ESCALA[opts.unidad] ? {unidad:opts.unidad, escala:ESCALA[opts.unidad]} : elegirUnidad(segs, opts.declarada);
      out.unidad = u.unidad; out.escala = u.escala;
      var o = out.origen = origen(segs), k = u.escala;
      // al marco local, redondeado a 1 nm: el DWG y su DXF exportado difieren en 1e-13 a 2e-12 y, sin esto, un umbral o un empate
      // de la búsqueda de pares los separa (muros de más o de menos, otro orden)
      var loc = function(p){ return [nano((p[0] - o[0]) * k), nano((p[1] - o[1]) * k)]; };
      var S = [];
      segs.forEach(function(s){ if (s && fin2(s.a) && fin2(s.b)) S.push({a:loc(s.a), b:loc(s.b), capa:s.capa, ancho:s.ancho == null ? null : nano(s.ancho * k)}); });
      S = canonicos(S);
      out.fondo = dibujos().masLargas(S, dibujos().FONDO_MAX).map(function(s){ return {a:s.a, b:s.b}; });
      progreso('unidad', 1);

      progreso('muros', 0);
      var pl = detectarPlano(S, {unaLinea:!!opts.unaLinea});
      out.avisos = pl.avisos.slice();
      progreso('muros', 1);

      progreso('dibujos', 0);
      out.dibujos = dibujos().separar(pl, S, textosCanonicos(lista(ap.textos)), lista(ap.arcos), loc, k, {debug:!!opts.debug});
      if (!out.dibujos.length) out.avisos.push('sin_muros');
      progreso('dibujos', 1);
    } catch (err) { out.dibujos = []; out.avisos = ['error']; out.debug = {error:String(err && err.stack || err)}; }
    if (!out.unidad){ out.unidad = ESCALA[opts.unidad] ? opts.unidad : ESCALA[opts.declarada] ? opts.declarada : 'm'; out.escala = ESCALA[out.unidad]; }
    return out;
  }
  // Orden canónico, para que el resultado no dependa del orden de las entidades en el archivo (el DWG y su DXF exportado, o el mismo
  // DXF guardado otra vez, traen las mismas líneas en otro orden): cada segmento va de su extremo menor (x, después y) al mayor y la lista
  // se ordena por extremos, capa y ancho. Las coordenadas se comparan redondeadas a 1 µm (el ruido de 7.000.000 no cambia el orden).
  function micro(v){ return Math.round(v * 1e6); }
  function nano(v){ return Math.round(v * 1e9) / 1e9; }
  function canonicos(S){
    S.forEach(function(s){
      var dx = micro(s.b[0]) - micro(s.a[0]), dy = micro(s.b[1]) - micro(s.a[1]);
      if (dx < 0 || (dx === 0 && dy < 0)){ var t = s.a; s.a = s.b; s.b = t; }
      s.capa = s.capa == null ? '' : String(s.capa);
      s.k = [micro(s.a[0]), micro(s.a[1]), micro(s.b[0]), micro(s.b[1]), s.ancho == null ? -1 : micro(s.ancho)];
    });
    S.sort(function(p, q){
      for (var i = 0; i < 4; i++) if (p.k[i] !== q.k[i]) return p.k[i] - q.k[i];
      return p.capa < q.capa ? -1 : p.capa > q.capa ? 1 : p.k[4] - q.k[4];
    });
    return S.map(function(s){ return {a:s.a, b:s.b, capa:s.capa, ancho:s.ancho}; });
  }
  function textosCanonicos(T){
    return T.filter(function(t){ return t && fin2(t.p) && t.txt != null; }).map(function(t){ return {p:t.p, txt:String(t.txt), k0:micro(t.p[0]), k1:micro(t.p[1])}; })
      .sort(function(p, q){ return p.k0 - q.k0 || p.k1 - q.k1 || (p.txt < q.txt ? -1 : p.txt > q.txt ? 1 : 0); });
  }

  var api = {elegirUnidad:elegirUnidad, origen:origen, puntajeCapas:puntajeCapas, detectarPlano:detectarPlano, analizar:analizar,
             Grilla:Grilla, EPS:EPS, ANCHO_MAX:ANCHO_MAX, clave:clave, MAX_CELDAS:MAX_CELDAS};
  // PESOS vive en dibujos.js; se expone también acá (el banco de prueba y las pruebas los leen o los cambian)
  Object.defineProperty(api, 'PESOS', {enumerable:true, get:function(){ return dibujos().PESOS; }});
  Object.defineProperty(api, 'FONDO_MAX', {enumerable:true, get:function(){ return dibujos().FONDO_MAX; }});
  if (nodo) module.exports = api;
  else root.FugaPlanos = api;
})(typeof self !== 'undefined' ? self : this);
