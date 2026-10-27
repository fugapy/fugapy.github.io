// Modelo y medidas de la demo «Cómputo desde plano».
// normalizar(manifiesto) → Modelo en metros; medir(modelo) → cantidades para el presupuesto;
// enContorno(muros) → qué muros están en el borde (exteriores propuestos).
// Reglas calibradas contra el cómputo del motor FUGA Tech (Casa Patio, Vivienda 8x12 y D1).
(function(root){
  'use strict';
  var DINTEL = 2.10;                 // altura de puertas y dintel de ventanas cuando falta 'alto'
  var ANTEPECHO = 1.00;              // antepecho de ventanas cuando falta
  var ALTO_AZULEJO_BANO = 1.80;    // altura del revestimiento en baños
  var AZULEJO_POR_ML_MESADA = 0.60;  // m² de azulejo por ml de mesada
  var MESADA_MAX = 3.50;             // tope de ml de mesada por cocina
  var ESCALA = {m:1, cm:0.01, mm:0.001};
  var TIPOS = ['bano','cocina','lavadero','dormitorio','estar','exterior','otro'];
  var REGLAS = [[/BA[ÑN]O/,'bano'],[/COCINA/,'cocina'],[/LAVADERO/,'lavadero'],[/DORM/,'dormitorio'],
                [/PATIO|GALER|AIRE ?LUZ/,'exterior'],[/ESTAR|SALA|COMEDOR/,'estar']];

  function tipoDesdeNombre(nombre){
    var n = String(nombre == null ? '' : nombre).toUpperCase();
    for (var i=0;i<REGLAS.length;i++) if (REGLAS[i][0].test(n)) return REGLAS[i][1];
    return 'otro';
  }
  function num(v, porDefecto){ v = Number(v); return isFinite(v) ? v : porDefecto; }
  function hayNum(v){ return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }
  function esPuerta(tipo){ return /^(puerta|paso)/.test(String(tipo || '')); }   // vano de paso (con o sin hoja)
  function conHoja(tipo){ return /^puerta/.test(String(tipo || '')); }          // puerta que se compra: no el paso libre
  function esVentana(tipo){ return /^ventana/.test(String(tipo || '')); }
  function punto(p, k){ return [num(p && p[0], 0)*k, num(p && p[1], 0)*k]; }
  function r2(v){ return Math.round((v + Number.EPSILON) * 100) / 100; }

  // Alto de una abertura: el declarado; si falta, dintel 2,10 menos el antepecho
  // (0 en puertas, 1,00 en ventanas). Así coincide con el motor en Vivienda y D1.
  function altoAbertura(o, k){
    if (hayNum(o.alto) && Number(o.alto) > 0) return Number(o.alto)*k;
    var ante = hayNum(o.antepecho) ? Number(o.antepecho)*k : (esPuerta(o.tipo) ? 0 : ANTEPECHO);
    return Math.max(0, r2(DINTEL - ante));
  }

  function normalizar(man){
    man = man || {};
    var k = ESCALA[man.unidades] || 1;
    var muros = (man.muros || []).map(function(w){
      return {id:w.id, de:punto(w.de,k), a:punto(w.a,k), esp:hayNum(w.esp) ? Number(w.esp)*k : 0.15,
              tipo:w.tipo === 'exterior' ? 'exterior' : 'interior'};
    });
    var aberturas = (man.aberturas || []).map(function(o){
      return {id:o.id, muro:o.muro, desde:num(o.desde,0)*k, ancho:num(o.ancho,0)*k, alto:altoAbertura(o,k),
              tipo:o.tipo || 'ventana'};
    });
    var ambientes = (man.ambientes || []).map(function(a){
      var tipo = TIPOS.indexOf(a.tipo) >= 0 ? a.tipo : tipoDesdeNombre(a.nombre);
      return {id:a.id, nombre:a.nombre || '', tipo:tipo, poligono:(a.poligono || []).map(function(p){ return punto(p,k); }),
              cubierto:cubierto({tipo:tipo, nombre:a.nombre, cubierto:a.cubierto})};
    });
    return {muros:muros, aberturas:aberturas, ambientes:ambientes};
  }

  // Lleva piso: todo lo que no es exterior, y además la galería (exterior pero techada).
  function cubierto(a){
    if (typeof a.cubierto === 'boolean') return a.cubierto;
    return a.tipo !== 'exterior' || /GALER/.test(String(a.nombre || '').toUpperCase());
  }
  function largo(w){ return Math.hypot(w.a[0]-w.de[0], w.a[1]-w.de[1]); }
  function vertices(p){   // sin el punto de cierre repetido
    p = p || [];
    var n = p.length;
    if (n > 1 && p[0][0] === p[n-1][0] && p[0][1] === p[n-1][1]) p = p.slice(0, n-1);
    return p;
  }
  function lados(p){
    p = vertices(p);
    var out = [];
    if (p.length < 2) return out;
    for (var i=0;i<p.length;i++){ var q = p[(i+1)%p.length]; out.push(Math.hypot(q[0]-p[i][0], q[1]-p[i][1])); }
    return out;
  }
  function area(p){
    p = vertices(p);
    var s = 0;
    for (var i=0;i<p.length;i++){ var q = p[(i+1)%p.length]; s += p[i][0]*q[1] - q[0]*p[i][1]; }
    return Math.abs(s)/2;
  }
  function perimetro(p){ return lados(p).reduce(function(s,l){ return s+l; }, 0); }
  // Mesada de una cocina: una sola tira sobre el lado más largo del polígono, con tope de 3,50 ml
  // (en cocinas grandes o integradas a sala-comedor el lado entero inflaría la mesada).
  function mesada(p){
    var l = lados(p);
    return l.length ? Math.min(Math.max.apply(null, l), MESADA_MAX) : 0;
  }

  // Rectángulo que envuelve los muros exteriores por su cara externa (si no hay, todos los muros).
  // Cada muro se ensancha media esp. hacia los costados, no a lo largo: sirve igual para muros
  // dibujados de eje a eje (Casa Patio) y de cara externa a cara externa (Vivienda, D1).
  function envolvente(muros){
    var ext = muros.filter(function(w){ return w.tipo === 'exterior'; });
    if (!ext.length) ext = muros;
    var x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
    ext.forEach(function(w){
      var l = largo(w);
      if (!l) return;
      var nx = -(w.a[1]-w.de[1])/l*w.esp/2, ny = (w.a[0]-w.de[0])/l*w.esp/2;
      [w.de, w.a].forEach(function(p){
        [[p[0]+nx, p[1]+ny], [p[0]-nx, p[1]-ny]].forEach(function(q){
          x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]);
          y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
        });
      });
    });
    if (x0 === Infinity) return {ancho:0, fondo:0};
    return {ancho:x1-x0, fondo:y1-y0};
  }

  // Muros del contorno: los dos extremos del eje a menos de esp + 0,05 m del mismo borde del rectángulo
  // que envuelve los muros (cada uno ensanchado media esp.). Devuelve un booleano por muro. Lo usan dxf.js
  // al proponer los exteriores y medir() cuando no hay ningún muro marcado como exterior.
  function enContorno(muros){
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    muros.forEach(function(w){
      var h = w.esp / 2;
      x0 = Math.min(x0, w.de[0] - h, w.a[0] - h); x1 = Math.max(x1, w.de[0] + h, w.a[0] + h);
      y0 = Math.min(y0, w.de[1] - h, w.a[1] - h); y1 = Math.max(y1, w.de[1] + h, w.a[1] + h);
    });
    return muros.map(function(w){
      var tol = w.esp + 0.05;
      return [[0, x0], [0, x1], [1, y0], [1, y1]].some(function(e){
        return Math.abs(w.de[e[0]] - e[1]) <= tol && Math.abs(w.a[e[0]] - e[1]) <= tol;
      });
    });
  }

  function medir(modelo, opciones){
    opciones = opciones || {};
    var h = hayNum(opciones.alturaMuros) ? Number(opciones.alturaMuros) : 2.80;
    var alero = hayNum(opciones.alero) ? Number(opciones.alero) : 0.40;
    var pendiente = hayNum(opciones.pendiente) ? Number(opciones.pendiente) : 0.15;
    modelo = modelo || {};
    var muros = modelo.muros || [], aberturas = modelo.aberturas || [], ambientes = modelo.ambientes || [];
    var porId = {}, datos = muros.map(function(w){   // un registro por muro; si un id se repite, vale el primero
      var d = {muro:w, largo:largo(w), vanos:0};
      if (!porId[w.id]) porId[w.id] = d;
      return d;
    });

    // Vanos: cada abertura se recorta a la longitud de su muro y a la altura de muros.
    // Puertas y ventanas se cuentan con el mismo recorte: la que no cae sobre un muro no cuenta.
    var areaVentanas = 0, cantidadPuertas = 0, cantidadVentanas = 0;
    aberturas.forEach(function(o){
      var m = porId[o.muro];
      if (!m) return;
      var desde = Math.max(0, num(o.desde,0)), hasta = Math.min(m.largo, desde + Math.max(0, num(o.ancho,0)));
      var vano = Math.max(0, hasta - desde) * Math.min(h, Math.max(0, num(o.alto,0)));
      m.vanos += vano;
      if (!(vano > 0)) return;
      if (conHoja(o.tipo)) cantidadPuertas++;
      if (esVentana(o.tipo)) { cantidadVentanas++; areaVentanas += vano; }
    });
    // Sin ningún muro exterior marcado (los dibujados a mano son interiores), se miden como exteriores
    // los del contorno. Solo para medir: el modelo no se toca.
    var inferidos = muros.length > 0 && !muros.some(function(w){ return w.tipo === 'exterior'; });
    var esExt = inferidos ? enContorno(muros) : muros.map(function(w){ return w.tipo === 'exterior'; });
    inferidos = inferidos && esExt.some(Boolean);
    var areaMuros = 0, pinturaExterior = 0, longitudMuros = 0, huella = 0, perimetroExterior = 0;
    datos.forEach(function(m, i){
      var w = m.muro, neta = Math.max(0, m.largo*h - m.vanos);
      areaMuros += neta; longitudMuros += m.largo; huella += m.largo * w.esp;
      if (esExt[i]) { pinturaExterior += neta; perimetroExterior += m.largo; }   // cara externa
    });

    var areaPiso = 0, perimetroZocalo = 0, azulejosBanos = 0, mesadaMl = 0;
    var banos = 0, cocinas = 0, lavaderos = 0, interiores = 0;
    ambientes.forEach(function(a){
      var tipo = a.tipo, poli = a.poligono || [];
      if (tipo === 'bano') { banos++; azulejosBanos += perimetro(poli) * ALTO_AZULEJO_BANO; }
      if (tipo === 'cocina') { cocinas++; mesadaMl += mesada(poli); }
      if (tipo === 'lavadero') lavaderos++;
      if (tipo !== 'exterior') interiores++;
      if (cubierto(a)) {
        areaPiso += area(poli);
        if (tipo !== 'bano') perimetroZocalo += perimetro(poli);   // el baño lleva azulejo, no zócalo
      }
    });
    var anchoPuertas = aberturas.reduce(function(s,o){ return s + (esPuerta(o.tipo) ? Math.max(0, num(o.ancho,0)) : 0); }, 0);

    var muros2 = r2(areaMuros), revoque = r2(2*muros2), pintExt = r2(pinturaExterior);
    var env = envolvente(muros), replanteo = env.ancho * env.fondo;
    // Cubierta: lo techado (pisos + huella de muros) más el alero alrededor de la envolvente,
    // inclinado según la pendiente de la chapa.
    var vuelo = replanteo > 0 ? 2*alero*(env.ancho + env.fondo) + 4*alero*alero : 0;
    var cubierta = (areaPiso + huella + vuelo) * Math.sqrt(1 + pendiente*pendiente);

    return {
      superficieReplanteo: r2(replanteo),
      superficieCubierta: r2(cubierta),
      superficieConstruida: r2(areaPiso + huella),   // pisos cubiertos + huella de muros, sin alero

      longitudMuros: r2(longitudMuros),
      areaMuros: muros2,
      areaMurosExteriores: pintExt,               // netas de vanos; exteriores + interiores = areaMuros
      areaMurosInteriores: r2(muros2 - pintExt),
      perimetroExterior: r2(perimetroExterior),
      exterioresInferidos: inferidos,             // true: los exteriores salen del contorno, no del dibujo
      areaRevoque: revoque,                       // dos caras
      pinturaInterior: r2(revoque - pintExt),     // interior + exterior = revoque, sin centavos sueltos
      pinturaExterior: pintExt,
      areaPiso: r2(areaPiso),
      zocaloMl: r2(Math.max(0, perimetroZocalo - anchoPuertas)),
      areaAzulejos: r2(azulejosBanos + mesadaMl*AZULEJO_POR_ML_MESADA),
      mesadaMl: r2(mesadaMl),
      aberturas: aberturas.map(function(o){ return {tipo:o.tipo, ancho:o.ancho, alto:o.alto}; }),
      areaVentanas: r2(areaVentanas),
      cantidadPuertas: cantidadPuertas, cantidadVentanas: cantidadVentanas,
      banos: banos, cocinas: cocinas, lavaderos: lavaderos, ambientesInteriores: interiores
    };
  }

  var api = {normalizar:normalizar, medir:medir, tipoDesdeNombre:tipoDesdeNombre, enContorno:enContorno};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FugaModelo = api;
})(typeof window === 'undefined' ? globalThis : window);
