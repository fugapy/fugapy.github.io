// Dibujos de la demo «Cómputo desde plano»: separa el archivo en dibujos (grupos de muros cercanos) y reconoce la planta.
// Lo llama planos.analizar después de detectar los muros; el detalle de lo que devuelve está en el comentario de analizar (planos.js).
// separar(pl, S, textos, arcos, loc, k, opts) → dibujos ordenados. pl = detectarPlano de los segmentos locales S (metros, orden canónico);
//   textos (orden canónico) y arcos en unidades del archivo (loc los pasa al marco local, k = escala). opts.debug: cada dibujo trae senales.
// PESOS: pesos del puntaje de planta (regla 4 del diseño), ajustados con el corpus; el banco de prueba puede cambiarlos.
// Funciona en Node, en la página y dentro de un Web Worker (se cuelga de self). Necesita modelo.js (enContorno) y planos.js (Grilla).
(function(root){
  'use strict';
  var nodo = typeof module !== 'undefined' && module.exports;
  var Mo = nodo ? require('./modelo.js') : null;
  function modelo(){ return Mo || root.FugaModelo; }
  function planos(){ return nodo ? require('./planos.js') : root.FugaPlanos; }   // se pide al usarlo (planos.js también pide este archivo)
  var EPS = 1e-6;
  function r(v){ return Math.round(v * 1e4) / 1e4; }
  function Grilla(c){ var G = planos().Grilla; return new G(c); }

  var UNE = 1.5;                          // dos muros cuyas cajas quedan a menos de esto van al mismo dibujo (m)
  var GRUPO_MUROS = 3, GRUPO_LARGO = 6;   // un grupo con menos muros o menos metros de muro no es un dibujo
  var MARGEN_TEXTO = 3;
  // Fondo de cada dibujo: las líneas a ≤ MARGEN_FONDO de su caja, y también las que llegan hasta MARGEN_FONDO_LEJOS si no son de otro dibujo
  // (no están a ≤ MARGEN_FONDO de la caja de otro que no sea marco). Así, donde faltan muros (galerías con pilares) igual se ve el plano para
  // calcar o marcar. Tope: FONDO_MAX líneas por dibujo (las más largas), para que el editor no se trabe.
  var MARGEN_FONDO = 0.5, MARGEN_FONDO_LEJOS = 3, FONDO_MAX = 20000;
  // Un título (planta, corte, fachada…) que queda DEBAJO de un dibujo, dentro de su ancho, es de ese dibujo hasta a 5 m:
  // en un legajo municipal del corpus los títulos están 3,4 m debajo de las plantas y a 3 m de la fachada que tienen abajo (con solo «el más cercano a 3 m»
  // el título de la planta alta quedaba en la fachada y el de la planta baja en ninguna).
  // «Dentro de su ancho»: el punto de un TEXT es su comienzo (abajo a la izquierda) y el texto sigue a la derecha, así que se acepta
  // hasta TITULO_IZQ a la izquierda de la caja (los títulos alineados con las cotas, no con los muros) y TITULO_DER a la derecha.
  // No vale si otro dibujo queda a ≤ TITULO_OTRO y a menos de la mitad de distancia: es una nota de ese otro dibujo (la de techo de un
  // corte, pegada a su borde de arriba y a 3 m de la planta), y va al más cercano.
  var MARGEN_TITULO = 5, TITULO_IZQ = 3, TITULO_DER = 1, TITULO_OTRO = 1;
  var BORDE = 0.05;                       // un muro está en el borde de su caja si su eje queda a esp/2 + esto del lado
  var IGUAL_CAJA = 0.02, IGUAL_LARGO = 0.05;
  // Además de caja y largo, dos iguales tienen que superponerse: llevando uno sobre el otro (por la esquina de la caja), al menos el
  // 80 % del largo de muros de CADA uno corre sobre un muro del otro (mismo sentido, eje a ≤ 5 cm). Así la PB y la PA de una vivienda del corpus, con la
  // misma huella y un largo parecido pero otros tabiques, no se unen (el diseño pide mostrar todas las plantas distintas).
  var IGUAL_COINCIDE = 0.8, IGUAL_EJE = 0.05;
  var HUELLA_MIN = 15, HUELLA_MAX = 2000, MUROS_PLANTA = 4;
  var PUERTA_RMIN = 0.55, PUERTA_RMAX = 1.10, PUERTA_TOL = 15 * Math.PI / 180;   // arco de puerta: abre 90° ± 15°
  var DIR_TOL = 10;                       // grados: un muro corre en una dirección si se aparta menos de esto
  var CELDA_CAJAS = 5;
  // Pesos del puntaje (regla 4 del diseño). Se ajustan con el corpus; el banco de prueba puede cambiarlos en PESOS.
  // Ajustados con el corpus (26/10/2026, ver computo/probar_corpus.mjs):
  //   - minimo 2 → 4: muros en dos direcciones (3) solos no alcanzan; hace falta además el título, un nombre de ambiente o dos puertas.
  //     Con 2, cortes, encofrados y láminas de estructura (tres legajos del corpus) salían como planta (36 falsas en 36 corridas);
  //     con 3,5 quedaba un detalle de antecedentes de otro legajo con una sola puerta; con 4, ninguna, y las mismas plantas primeras.
  //   - textoPlanta solo por el TÍTULO del dibujo; los nombres de ambiente suman aparte y menos (textoAmbiente): un corte también los tiene.
  //   - textoInstalacion: planta eléctrica, de desagüe, agua o PCI; sigue siendo planta, pero va después de la de arquitectura.
  //   - textoOtro por el título de corte, fachada…; textoOtroSuelto si el texto está en el dibujo pero no es su título (marcas de corte).
  var PESOS = {dosDirecciones:3, parteDireccion:0.25, puerta:0.5, puertasMax:3, textoPlanta:2, textoAmbiente:1, textoInstalacion:-1.5,
               textoOtro:-4, textoOtroSuelto:-1, pocoVertical:-2, parteVertical:0.15, minimo:4};
  // Textos: cuentan si EMPIEZAN con la palabra (así «VER DETALLE» o «LÍNEA DE TECHO» dentro de una planta no restan),
  // salvo que la palabra vaya seguida de «:», que es un campo del rótulo («UBICACIÓN: …»), no un título.
  var TXT_OTRO = /^(CORTE|SECCION|FACHADA|VISTA|ELEVACION|UBICACION|LOCALIZACION|DETALLE|TECHO|ESTRUCTURA|FUNDACION|ENCOFRADO)/;
  var TXT_PLANTA = /^(PLANTAS?|PB|PA|NIVEL)\b|^P\.\s?[AB]\b/;   // «PLANTA», «PLANTAS», «PB», «P.B.»
  // «PLANTA DE TECHOS»; CUBIERTA solo como «PLANTA DE (LA|LAS) CUBIERTA(S)»: «PLANTA BAJA – SUP. CUBIERTA 120 m²» es planta
  var TXT_NO_PLANTA = /TECHO|AZOTEA|^PLANTAS?\s+(DE\s+)?(LAS?\s+)?CUBIERTAS?\b|UBICACION|LOCALIZACION|ESTRUCTUR|DETALLE|FUNDACION|ENCOFRADO|VIGA|LOSA/;
  var TXT_INSTALACION = /INSTALACI|ELECTRIC|SANITARI|DESAGUE|CLOACAL|PLUVIAL|\bAGUA\b|P\.?C\.?I\b|INCENDIO/;
  var TXT_AMBIENTE = /^(DORM|BANO|COCINA|ESTAR|COMEDOR|LAVADERO|GARA[JG]E|QUINCHO)/;

  function lista(v){ return Array.isArray(v) ? v : []; }
  function fin2(p){ return !!p && isFinite(p[0]) && isFinite(p[1]); }
  function textoPlano(t){
    var s = String(t).toUpperCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');   // BAÑO → BANO, ELEVACIÓN → ELEVACION
    return s.replace(/^[^A-Z0-9]+/, '').replace(/^\d+(\s*[-.)\u2013\u2014:]\s*|\s+)(?=[A-Z])/, '');   // «1 - PLANTA BAJA» → «PLANTA BAJA»
  }
  // 'otro' (corte, fachada, ubicación, encofrado…), 'planta' (título de planta), 'instalacion' (planta eléctrica, de desagüe…),
  // 'ambiente' o null
  function tipoTexto(t){
    var s = textoPlano(t);
    if (esCampo(s)) return null;
    if (TXT_OTRO.test(s)) return 'otro';
    if (TXT_PLANTA.test(s)) return TXT_NO_PLANTA.test(s) ? 'otro' : TXT_INSTALACION.test(s) ? 'instalacion' : 'planta';
    if (/^INSTALACI/.test(s)) return 'instalacion';
    return TXT_AMBIENTE.test(s) ? 'ambiente' : null;
  }
  // Campo de rótulo: «UBICACIÓN: Asunción», «NIVEL DE CALZADA: A RELEVAR», «Corte :». No lo es:
  //   - si los dos puntos son de una escala: «PLANTA BAJA ESC 1:50», «CORTE A-A (1:50)» (entre cifras no cuentan),
  //     «FACHADA PRINCIPAL ESC: 1/50», «PLANTA BAJA: ESC 1/50»;
  //   - si empieza con la palabra del dibujo y sigue algo después de los dos puntos: «PLANTA BAJA: 120 M2».
  var CAMPO_TITULO = /^(PLANTAS?|PB|PA|P\.\s?[AB]|CORTE|SECCION|FACHADA|VISTA|ELEVACION)\b/;
  function esCampo(s){
    var i = s.replace(/(\d)\s*:\s*(?=\d)/g, '$1/').indexOf(':');
    if (i < 0) return false;
    var antes = s.slice(0, i).trim(), despues = s.slice(i + 1).trim();
    if (despues && CAMPO_TITULO.test(antes)) return false;
    return !/\bESC(ALA)?\.?$/.test(antes) && !/^(ESC(ALA)?\b|1\s*\/\s*\d)/.test(despues);
  }
  function esTitulo(tipo){ return tipo === 'planta' || tipo === 'instalacion' || tipo === 'otro'; }
  // ¿Todos los muros corren sobre el borde de la caja b (horizontales arriba o abajo, verticales a los lados)? Un marco de lámina.
  function enBorde(ms, b){
    return ms.every(function(w){
      var dx = Math.abs(w.a[0] - w.de[0]), dy = Math.abs(w.a[1] - w.de[1]), e = w.esp + BORDE;
      var x = (w.de[0] + w.a[0]) / 2, y = (w.de[1] + w.a[1]) / 2;
      if (dy <= dx * 0.035) return Math.abs(y - b[1]) <= e || Math.abs(y - b[3]) <= e;
      if (dx <= dy * 0.035) return Math.abs(x - b[0]) <= e || Math.abs(x - b[2]) <= e;
      return false;
    });
  }
  function esPuerta(r, a0, a1){
    if (!(r >= PUERTA_RMIN - EPS && r <= PUERTA_RMAX + EPS) || !isFinite(a0) || !isFinite(a1)) return false;
    var s = ((a1 - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return Math.abs(s - Math.PI / 2) <= PUERTA_TOL;
  }
  // Caja de un muro: el eje ensanchado media esp. hacia los costados (no a lo largo), como la envolvente de modelo.js.
  function cajaMuro(w){
    var dx = w.a[0] - w.de[0], dy = w.a[1] - w.de[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * w.esp / 2, ny = dx / L * w.esp / 2;
    return [Math.min(w.de[0], w.a[0]) - Math.abs(nx), Math.min(w.de[1], w.a[1]) - Math.abs(ny),
            Math.max(w.de[0], w.a[0]) + Math.abs(nx), Math.max(w.de[1], w.a[1]) + Math.abs(ny)];
  }
  function distCajas(p, q){ return Math.hypot(Math.max(0, q[0] - p[2], p[0] - q[2]), Math.max(0, q[1] - p[3], p[1] - q[3])); }
  function contiene(p, q){ return p[0] <= q[0] && p[1] <= q[1] && p[2] >= q[2] && p[3] >= q[3]; }
  function igual(a, b, tol){ return Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b)); }
  // Índice de cajas (ensanchadas «margen») por celdas: en(p) → índices de las cajas que quizá tocan p.
  function indiceCajas(cajas, margen){
    var m = new Map(), grandes = [], c = CELDA_CAJAS, clave = planos().clave;
    cajas.forEach(function(b, k){
      var i0 = Math.floor((b[0] - margen) / c), i1 = Math.floor((b[2] + margen) / c), j0 = Math.floor((b[1] - margen) / c), j1 = Math.floor((b[3] + margen) / c);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > planos().MAX_CELDAS){ grandes.push(k); return; }
      for (var i = i0; i <= i1; i++) for (var j = j0; j <= j1; j++){ var q = clave(i, j), l = m.get(q); if (l) l.push(k); else m.set(q, [k]); }
    });
    return function(p){ var l = m.get(clave(Math.floor(p[0] / c), Math.floor(p[1] / c))) || []; return grandes.length ? l.concat(grandes) : l; };
  }
  // Muros → grupos por cercanía de cajas (unión de conjuntos, con la grilla). Devuelve listas de índices de muros.
  function agruparMuros(muros, cajas){
    var g = Grilla(2), padre = muros.map(function(w, k){ return k; });
    function raiz(k){ while (padre[k] !== k){ padre[k] = padre[padre[k]]; k = padre[k]; } return k; }
    muros.forEach(function(w, k){ g.agregar(k, w.de, w.a); });
    muros.forEach(function(w, k){
      g.lista(w.de, w.a, UNE + w.esp / 2 + planos().ANCHO_MAX / 2).forEach(function(j){
        if (j === k || distCajas(cajas[k], cajas[j]) >= UNE) return;
        var a = raiz(k), b = raiz(j);
        if (a !== b) padre[Math.max(a, b)] = Math.min(a, b);
      });
    });
    var porRaiz = new Map(), grupos = [];
    muros.forEach(function(w, k){ var q = raiz(k), l = porRaiz.get(q); if (l) l.push(k); else { porRaiz.set(q, [k]); grupos.push(porRaiz.get(q)); } });
    return grupos;
  }
  // Largo por dirección: la principal (±DIR_TOL) y su perpendicular, como fracción del total; y la fracción vertical (|dy| > |dx|).
  function direcciones(muros){
    var hist = [], total = 0, vert = 0, k, i;
    for (k = 0; k < 180; k++) hist.push(0);
    muros.forEach(function(w){
      var dx = w.a[0] - w.de[0], dy = w.a[1] - w.de[1], L = Math.hypot(dx, dy), th = Math.atan2(dy, dx) * 180 / Math.PI;
      hist[Math.floor(((th % 180) + 180) % 180) % 180] += L; total += L;
      if (Math.abs(dy) > Math.abs(dx)) vert += L;
    });
    function ventana(b){ var s = 0; for (var d = -DIR_TOL; d <= DIR_TOL; d++) s += hist[((b + d) % 180 + 180) % 180]; return s; }
    var mejor = 0, bm = 0;
    for (i = 0; i < 180; i++){ var v = ventana(i); if (v > mejor){ mejor = v; bm = i; } }
    total = total || 1;
    return {una:mejor / total, otra:ventana(bm + 90) / total, vertical:vert / total};
  }


  function separar(pl, S, textos, arcos, loc, k, opts){
    opts = opts || {};
    var muros = pl.muros, cajasM = muros.map(cajaMuro);
    var G = [];
    agruparMuros(muros, cajasM).forEach(function(ix){
      var L = 0, c = [Infinity, Infinity, -Infinity, -Infinity];
      ix.forEach(function(i){
        var w = muros[i], b = cajasM[i];
        L += Math.hypot(w.a[0] - w.de[0], w.a[1] - w.de[1]);
        c = [Math.min(c[0], b[0]), Math.min(c[1], b[1]), Math.max(c[2], b[2]), Math.max(c[3], b[3])];
      });
      if (ix.length >= GRUPO_MUROS && L >= GRUPO_LARGO - EPS){
        var ms = ix.map(function(i){ return muros[i]; });
        G.push({n:G.length, id:'G' + (G.length + 1), ix:ix, L:L, caja:c.map(r), textos:[], puertas:0, contenedor:false, borde:enBorde(ms, c)});
      }
    });
    if (!G.length) return [];
    var cajas = G.map(function(g){ return g.caja; }), en = indiceCajas(cajas, Math.max(MARGEN_TEXTO, MARGEN_TITULO));
    G.forEach(function(g){   // contenedor: su caja encierra la de otro dibujo
      var c = g.caja, centro = [(c[0] + c[2]) / 2, (c[1] + c[3]) / 2];
      en(centro).forEach(function(j){ if (G[j] !== g && contiene(G[j].caja, c)) G[j].contenedor = true; });
    });
    // marco de lámina: contiene otros dibujos y todos sus muros corren sobre el borde de su caja
    G.forEach(function(g){ g.marco = g.contenedor && g.borde; });
    function area(b){ return (b[2] - b[0]) * (b[3] - b[1]); }
    // Textos y arcos: al dibujo que los contiene o al más cercano a ≤ 3 m; a igual distancia, al más chico; los marcos, solo si no hay
    // otro. Un título que queda debajo de un dibujo (≤ 5 m, dentro de su ancho) va primero a ese dibujo, salvo que esté pegado a otro
    // (TITULO_OTRO). → {g, titulo, dy} o null
    function dist(p, b){ return Math.hypot(Math.max(0, b[0] - p[0], p[0] - b[2]), Math.max(0, b[1] - p[1], p[1] - b[3])); }
    function asignar(p, titulo){
      var mejor = null, md = 0;
      if (titulo) en(p).forEach(function(j){
        var g = G[j], b = g.caja, d = b[1] - p[1];
        if (g.marco || d < -EPS || d > MARGEN_TITULO + EPS || p[0] < b[0] - TITULO_IZQ || p[0] > b[2] + TITULO_DER) return;
        if (!mejor || d < md || (d === md && area(b) < area(mejor.caja))){ mejor = g; md = d; }
      });
      if (mejor && !en(p).some(function(j){
        var g = G[j], d = dist(p, g.caja);
        return g !== mejor && !g.marco && d <= TITULO_OTRO + EPS && d < md / 2;
      })) return {g:mejor, titulo:true, dy:md};
      mejor = null;
      en(p).forEach(function(j){
        var g = G[j], b = g.caja, d = dist(p, b);
        if (d > MARGEN_TEXTO + EPS) return;
        if (!mejor || (g.marco !== mejor.marco ? !g.marco : d < md || (d === md && area(b) < area(mejor.caja)))){ mejor = g; md = d; }
      });
      return mejor && {g:mejor, titulo:false, dy:Infinity};
    }
    textos.forEach(function(t){
      if (!t || !fin2(t.p) || t.txt == null) return;
      var p = loc(t.p), tipo = tipoTexto(t.txt), a = fin2(p) && asignar(p, esTitulo(tipo));
      if (a) a.g.textos.push({p:p, txt:String(t.txt).trim(), tipo:tipo, titulo:a.titulo, dy:a.dy});
    });
    arcos.forEach(function(c){
      if (!c || !fin2(c.c) || !esPuerta(c.r * k, c.a0, c.a1)) return;
      var p = loc(c.c), a = fin2(p) && asignar(p, false);
      if (a) a.g.puertas++;
    });
    // Título: el que quedó debajo del dibujo (el más pegado a su borde inferior); si no hay, el texto de planta, corte, fachada…
    // más cerca del centro del borde inferior de la caja.
    G.forEach(function(g){
      var c = g.caja, base = [(c[0] + c[2]) / 2, c[1]], dt = Infinity;
      g.titulo = null;
      g.textos.forEach(function(t){
        if (!esTitulo(t.tipo)) return;
        var d = t.titulo ? t.dy - 1e9 : Math.hypot(t.p[0] - base[0], t.p[1] - base[1]);
        if (d < dt){ dt = d; g.titulo = t; }
      });
    });
    // Puntaje
    G.forEach(function(g){
      var ms = g.ix.map(function(i){ return muros[i]; }), d = direcciones(ms), P = PESOS, s = 0, tt = g.titulo && g.titulo.tipo;
      var otros = g.textos.filter(function(t){ return t !== g.titulo; }).map(function(t){ return t.tipo; });
      if (d.una >= P.parteDireccion - EPS && d.otra >= P.parteDireccion - EPS) s += P.dosDirecciones;
      s += Math.min(P.puertasMax, P.puerta * g.puertas);
      if (tt === 'planta' || tt === 'instalacion') s += P.textoPlanta;
      if (tt === 'instalacion') s += P.textoInstalacion;
      if (tt === 'otro') s += P.textoOtro;
      if (otros.indexOf('ambiente') >= 0) s += P.textoAmbiente;
      if (otros.indexOf('otro') >= 0) s += P.textoOtroSuelto;
      if (d.vertical < P.parteVertical - EPS) s += P.pocoVertical;
      var c = g.caja, huella = (c[2] - c[0]) * (c[3] - c[1]);
      g.puntaje = r(s);
      g.senales = {una:r(d.una), otra:r(d.otra), vertical:r(d.vertical), puertas:g.puertas, huella:r(huella), contenedor:g.contenedor, marco:g.marco,
                   textos:g.textos.filter(function(t){ return t.tipo; }).slice(0, 12).map(function(t){ return t.tipo + ':' + t.txt; })};
      g.esPlanta = s >= P.minimo - EPS && huella >= HUELLA_MIN - EPS && huella <= HUELLA_MAX + EPS && ms.length >= MUROS_PLANTA && !g.marco;
    });
    // ¿Coincide al menos IGUAL_COINCIDE del largo de muros de a con muros de b, con a corrido (dx, dy)? Grilla de b guardada en b.
    function coincide(a, b, dx, dy){
      if (!b.grilla){
        b.grilla = Grilla(1);
        b.ix.forEach(function(i, k){ b.grilla.agregar(k, muros[i].de, muros[i].a); });
      }
      var tot = 0, ok = 0;
      a.ix.forEach(function(i){
        var w = muros[i], P = [w.de[0] + dx, w.de[1] + dy], Q = [w.a[0] + dx, w.a[1] + dy];
        var L = Math.hypot(Q[0] - P[0], Q[1] - P[1]), ux = (Q[0] - P[0]) / L, uy = (Q[1] - P[1]) / L, sobre = 0;
        tot += L;
        if (!(L > 0)) return;
        b.grilla.lista(P, Q, IGUAL_EJE).forEach(function(k){
          var v = muros[b.ix[k]], vx = v.a[0] - v.de[0], vy = v.a[1] - v.de[1], Lv = Math.hypot(vx, vy);
          if (!(Lv > 0) || Math.abs(ux * vy - uy * vx) / Lv > 0.035) return;
          var d1 = -uy * (v.de[0] - P[0]) + ux * (v.de[1] - P[1]), d2 = -uy * (v.a[0] - P[0]) + ux * (v.a[1] - P[1]);
          if (Math.abs(d1) > IGUAL_EJE || Math.abs(d2) > IGUAL_EJE) return;
          var t1 = ux * (v.de[0] - P[0]) + uy * (v.de[1] - P[1]), t2 = ux * (v.a[0] - P[0]) + uy * (v.a[1] - P[1]);
          sobre += Math.max(0, Math.min(L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)));
        });
        ok += Math.min(L, sobre);
      });
      return tot > 0 && ok >= IGUAL_COINCIDE * tot - EPS;
    }
    function superpuestos(g, o){
      var dx = o.caja[0] - g.caja[0], dy = o.caja[1] - g.caja[1];
      return coincide(g, o, dx, dy) && coincide(o, g, -dx, -dy);
    }
    // Iguales: se recorren de mayor a menor puntaje; cada uno se une al primero igual ya guardado (cubetas por largo de muros).
    var orden = G.slice().sort(function(a, b){ return b.puntaje - a.puntaje || (b.esPlanta - a.esPlanta) || a.n - b.n; });
    var cubetas = new Map(), quedan = [], paso = Math.log(1 + IGUAL_LARGO);
    orden.forEach(function(g){
      var q = Math.floor(Math.log(g.L) / paso), w = g.caja[2] - g.caja[0], h = g.caja[3] - g.caja[1], igualA = null;
      // ±5 % del mayor es hasta log(1/0,95) = 1,05 cubetas de log(1,05): dos iguales pueden quedar a dos cubetas de distancia
      for (var e = q - 2; e <= q + 2 && !igualA; e++) (cubetas.get(e) || []).some(function(o){
        var ok = igual(g.L, o.L, IGUAL_LARGO) && igual(w, o.caja[2] - o.caja[0], IGUAL_CAJA) && igual(h, o.caja[3] - o.caja[1], IGUAL_CAJA) &&
                 superpuestos(g, o);
        if (ok) igualA = o;
        return ok;
      });
      if (igualA){ igualA.ids.push(g.id); igualA.cajas.push(g.caja); return; }
      g.ids = [g.id]; g.cajas = [g.caja]; quedan.push(g);
      (cubetas.get(q) || cubetas.set(q, []).get(q)).push(g);
    });
    // Fondo de cada dibujo que queda (ver MARGEN_FONDO): los extremos se miran contra las cajas de todos los dibujos, unidos o no
    function adentro(s, b, m){ return [s.a, s.b].every(function(p){ return p[0] >= b[0] - m && p[0] <= b[2] + m && p[1] >= b[1] - m && p[1] <= b[3] + m; }); }
    var enF = indiceCajas(quedan.map(function(g){ return g.caja; }), MARGEN_FONDO_LEJOS), enG = indiceCajas(cajas, MARGEN_FONDO);
    quedan.forEach(function(g){ g.fondo = []; });
    S.forEach(function(s){
      var cerca = null;   // dibujos (de G) que tienen el segmento a ≤ MARGEN_FONDO: se calcula una vez, solo si hace falta
      enF(s.a).forEach(function(j){
        var g = quedan[j];
        if (!adentro(s, g.caja, MARGEN_FONDO_LEJOS)) return;
        if (!adentro(s, g.caja, MARGEN_FONDO)){
          if (!cerca) cerca = enG(s.a).filter(function(i){ return !G[i].marco && adentro(s, G[i].caja, MARGEN_FONDO); });
          if (cerca.length) return;
        }
        g.fondo.push({a:s.a, b:s.b});
      });
    });
    quedan.forEach(function(g){ g.fondo = masLargas(g.fondo, FONDO_MAX); });
    return quedan.sort(function(a, b){
      return (b.esPlanta - a.esPlanta) || b.puntaje - a.puntaje || b.ids.length - a.ids.length || b.puertas - a.puertas || b.L - a.L || a.n - b.n;
    })
      .map(function(g){
        var nuevo = {}, ms = g.ix.map(function(i, n){
          var w = muros[i];
          nuevo[w.id] = 'D' + (n + 1);
          return {id:'D' + (n + 1), de:w.de, a:w.a, esp:w.esp, tipo:'interior', propuesto:true};
        });
        modelo().enContorno(ms).forEach(function(si, n){ if (si) ms[n].tipo = 'exterior'; });
        var ab = pl.aberturas.filter(function(a){ return hay(nuevo, a.muro); }).map(function(a, n){
          var c = {}; for (var q in a) c[q] = a[q];
          c.id = 'DA' + (n + 1); c.muro = nuevo[a.muro];
          return c;
        });
        var titulo = g.titulo ? g.titulo.txt : null;
        var dib = {id:g.id, caja:g.caja, muros:ms, aberturas:ab, fondo:g.fondo, puntaje:g.puntaje, esPlanta:g.esPlanta,
                   etiqueta:titulo, repeticiones:g.ids.length, ids:g.ids, cajas:g.cajas};
        if (opts.debug) dib.senales = g.senales;
        return dib;
      });
  }
  function hay(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }
  // Las «max» líneas {a, b} más largas de la lista (a igual largo, las primeras), en el orden en que venían. Con max o menos, la misma lista.
  function masLargas(segs, max){
    if (segs.length <= max) return segs;
    var L = function(s){ return Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]); };
    return segs.map(function(s, i){ return {s:s, i:i, L:L(s)}; }).sort(function(x, y){ return y.L - x.L || x.i - y.i; })
      .slice(0, max).sort(function(x, y){ return x.i - y.i; }).map(function(x){ return x.s; });
  }
  var api = {separar:separar, masLargas:masLargas, PESOS:PESOS, FONDO_MAX:FONDO_MAX};
  if (nodo) module.exports = api;
  else root.FugaDibujos = api;
})(typeof self !== 'undefined' ? self : this);
