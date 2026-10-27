// Fachada compatible de la demo «Cómputo desde plano»: la lectura vive en lector.js y la detección en planos.js.
// leerDxf(texto) → {segmentos:[{a,b,capa,ancho}], unidad, unidadDeclarada, escala}; todo sale en metros. Explota bloques
//   (lector.leerDxfDoc + aplanar) y elige la unidad por geometría (planos.elegirUnidad), sin confiar en $INSUNITS.
// detectarPlano(segmentos, opts) → {muros, aberturas, avisos}: delega en planos.detectarPlano. detectarMuros(segmentos) = detectarPlano(...).muros.
// En el navegador se cargan antes modelo.js, lector.js y planos.js.
(function(root){
  'use strict';
  var nodo = typeof module !== 'undefined' && module.exports;
  function Lc(){ return nodo ? require('./lector.js') : root.FugaLector; }
  function Pl(){ return nodo ? require('./planos.js') : root.FugaPlanos; }

  function leerDxf(texto){
    var doc = Lc().leerDxfDoc(texto), segs = Lc().aplanar(doc).segmentos, u = Pl().elegirUnidad(segs, doc.unidadDeclarada), k = u.escala;
    return {
      segmentos: segs.map(function(s){ return {a:[s.a[0]*k, s.a[1]*k], b:[s.b[0]*k, s.b[1]*k], capa:s.capa, ancho:s.ancho == null ? null : s.ancho*k}; }),
      unidad: u.unidad, unidadDeclarada: doc.unidadDeclarada, escala: k
    };
  }
  function detectarPlano(segmentos, opts){ return Pl().detectarPlano(segmentos, opts); }
  function detectarMuros(segmentos){ return detectarPlano(segmentos).muros; }

  var api = {leerDxf:leerDxf, detectarMuros:detectarMuros, detectarPlano:detectarPlano};
  if (nodo) module.exports = api;
  else root.FugaDxf = api;
})(typeof self !== 'undefined' ? self : this);
