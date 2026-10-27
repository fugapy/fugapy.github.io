// Ayudas puras del selector de dibujos de la demo «Cómputo desde plano» (app.js arma la pantalla; los textos viven en app.js, TXT).
// miniatura(dibujo) → SVG (texto) del dibujo: viewBox en metros con y hacia arriba (y → −y), «fondo» como un solo path
//   (clase mini-fondo, gris) y los muros como líneas del espesor del muro (clase mini-muros, color de acento). Con más de
//   MAX_FONDO líneas de fondo quedan las más largas. El trazo nunca es más fino que 1/160 del lado mayor (se ve en 160 px).
// describir(dibujo, i, maxMuros) → {titulo, medida:'12,3 × 8,4 m', laminas:'aparece en 3 láminas' | '', planta, grande}.
//   titulo = etiqueta o «Dibujo N». grande = más de maxMuros muros: no se puede elegir en la demo.
// inicial(dibujos, maxMuros) → índice del dibujo que se carga directo (la única planta, si no es grande) o −1 (se muestra el selector).
// notas(resultado) → claves de avisos de lectura para el usuario: 'cortado' (archivo cortado en el tope), 'bloques' (bloques que faltan,
//   se llaman a sí mismos, anidados de más o con escala absurda), 'extrusion' (entidades en otro sistema de coordenadas), 'una_linea'.
// etapa(nombre, lectorBajado) → clave del texto de progreso: 'bajando' | 'leyendo' | 'muros' | 'dibujos'.
// Funciona en Node (pruebas) y en la página (FugaSelector).
(function(root){
  'use strict';
  var MAX_FONDO = 3000, LADO_PX = 160;
  var BLOQUES = ['bloque_inexistente', 'bloque_recursivo', 'anidado_profundo', 'escala_invalida'];

  function lista(v){ return Array.isArray(v) ? v : []; }
  function fin(p){ return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]); }
  function n(v){ return String(Math.round(v * 1000) / 1000); }
  function largo(s){ return Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]); }
  function uno(v){ return v.toLocaleString('es-PY', {minimumFractionDigits:1, maximumFractionDigits:1}); }

  function miniatura(d){
    var c = d && Array.isArray(d.caja) && d.caja.every(isFinite) ? d.caja : [0, 0, 1, 1];
    var lado = Math.max(c[2] - c[0], c[3] - c[1], 0.5), m = lado * 0.04;
    var x0 = c[0] - m, y0 = c[1] - m, w = c[2] - c[0] + 2 * m, h = c[3] - c[1] + 2 * m;
    var g = (lado + 2 * m) / LADO_PX;
    var fondo = lista(d && d.fondo).filter(function(s){ return s && fin(s.a) && fin(s.b); });
    if (fondo.length > MAX_FONDO) fondo = fondo.slice().sort(function(a, b){ return largo(b) - largo(a); }).slice(0, MAX_FONDO);
    var f = fondo.map(function(s){ return 'M' + n(s.a[0]) + ' ' + n(-s.a[1]) + 'L' + n(s.b[0]) + ' ' + n(-s.b[1]); }).join('');
    var muros = lista(d && d.muros).filter(function(x){ return x && fin(x.de) && fin(x.a); }).map(function(x){
      return '<line x1="' + n(x.de[0]) + '" y1="' + n(-x.de[1]) + '" x2="' + n(x.a[0]) + '" y2="' + n(-x.a[1]) +
        '" stroke-width="' + n(Math.max(x.esp > 0 ? x.esp : 0, g * 1.5)) + '"/>';
    }).join('');
    return '<svg class="mini" viewBox="' + [n(x0), n(-(y0 + h)), n(w), n(h)].join(' ') + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      (f ? '<path class="mini-fondo" d="' + f + '" stroke-width="' + n(g * 0.7) + '"/>' : '') +
      '<g class="mini-muros">' + muros + '</g></svg>';
  }

  function describir(d, i, maxMuros){
    var c = d.caja, rep = d.repeticiones | 0;
    return {
      titulo: d.etiqueta ? String(d.etiqueta) : 'Dibujo ' + (i + 1),
      medida: uno(c[2] - c[0]) + ' × ' + uno(c[3] - c[1]) + ' m',
      laminas: rep > 1 ? 'aparece en ' + rep + ' láminas' : '',
      planta: !!d.esPlanta,
      grande: lista(d.muros).length > maxMuros
    };
  }

  function inicial(dibujos, maxMuros){
    var plantas = [];
    lista(dibujos).forEach(function(d, i){ if (d && d.esPlanta) plantas.push(i); });
    return plantas.length === 1 && lista(dibujos[plantas[0]].muros).length <= maxMuros ? plantas[0] : -1;
  }

  function notas(res){
    var a = lista(res && res.avisos), out = [];
    var tiene = function(k){ return a.indexOf(k) >= 0; };
    if ((res && res.lectura && res.lectura.cortado) || tiene('grande')) out.push('cortado');
    if (BLOQUES.some(tiene)) out.push('bloques');
    if (tiene('extrusion')) out.push('extrusion');
    if (tiene('una_linea')) out.push('una_linea');
    return out;
  }

  function etapa(nombre, lectorBajado){
    if (nombre === 'carga') return lectorBajado ? 'leyendo' : 'bajando';
    if (nombre === 'unidad' || nombre === 'muros') return 'muros';
    if (nombre === 'dibujos') return 'dibujos';
    return 'leyendo';   // lectura, aplanado
  }

  var api = {miniatura:miniatura, describir:describir, inicial:inicial, notas:notas, etapa:etapa, MAX_FONDO:MAX_FONDO};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FugaSelector = api;
})(typeof self !== 'undefined' ? self : this);
