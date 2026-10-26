// Rubros de la demo «Cómputo desde plano»: el generador «Por rubros» del presupuestador (gen())
// portado a una función pura, con las cantidades medibles tomadas del plano.
// rubros(par, null)    → lo mismo que gen() del presupuestador, renglón por renglón.
// rubros(par, medidas) → N = 1, U = 1; superficie construida (sin alero), perímetro, baños y
//                        cocinas del plano, y los renglones medibles con la cantidad medida
//                        («medido en el plano»); los que salen de A, F o P dicen «estimado por m²».
//                        Sin pisos cubiertos pero con muros, A = F = replanteo, provisorio («estimado: marcá
//                        los ambientes»); sin perímetro exterior, P sale de F como en gen().
// presupuestar(lineas, precios) → renglones con precio y total en guaraníes.
(function(root, fabrica){
  if (typeof module === 'object' && module.exports) module.exports = fabrica(require('./datos.js'));
  else root.FugaReglas = fabrica(root.FugaComputoDatos);
})(typeof self !== 'undefined' ? self : this, function(D){
  'use strict';
  var PRECIOS = (D && D.PRECIOS) || {};
  var OPCIONES_POR_DEFECTO = {est:'muros', tec:'teja', mur:'hueco', pis:'cer', cie:'yeso', abe:'chapa', des:'red'};
  var MEDIDO = 'medido en el plano', ESTIMADO = 'estimado por m²', PROVISORIO = 'estimado: marcá los ambientes';

  function rubros(par, med){
    par = par || {};
    var A, N, U, B, K, F, P, provA = false, provP = false;
    if (med) {
      // A = F: superficie construida (pisos cubiertos + huella de muros), sin alero; los factores
      // ×1,25 / ×1,2 de gen() ya suman el alero en el techo.
      if (!(med.superficieCubierta > 0) || !(med.superficieConstruida > 0)) return [];
      A = med.superficieConstruida; N = 1; U = 1; B = med.banos || 0; K = med.cocinas || 0;
      // Muros sin ambientes cubiertos: la huella sola no es la obra; se toma el replanteo, provisorio.
      if (!(med.areaPiso > 0) && med.longitudMuros > 0 && med.superficieReplanteo > 0){ A = med.superficieReplanteo; provA = true; }
      F = A; P = med.perimetroExterior || 0;
      if (!(P > 0)){ P = 4*Math.sqrt(F)*1.15; provP = provA; }   // como gen(); si F es provisorio, P también
    } else {
      A = Math.max(1, +par.m2||0); N = Math.max(1, +par.niv||1); U = Math.max(1, +par.uni||1);
      B = +par.ban||0; K = +par.coc||0;
      F = A / N; P = 4*Math.sqrt(F)*1.15;
    }
    var est = par.est, tec = par.tec, mur = par.mur, pis = par.pis, cie = par.cie, abe = par.abe, des = par.des;
    var alt = abe === 'alu';
    // Notas con medidas: m() en los renglones medidos; e() en los que dependen de A, F o P
    // (proporciones). Los de cantidad fija o por baño/cocina/unidad conservan su nota.
    // Con A provisorio, los de A o F (e) y los de P cuando P sale de F (eP) suman «estimado: marcá los ambientes».
    var m = function(n){ return med ? MEDIDO : n; };
    var nota = function(n, prov){ return med ? (n ? n + ' · ' : '') + ESTIMADO + (prov ? ' · ' + PROVISORIO : '') : n; };
    var e = function(n){ return nota(n, provA); }, eP = function(n){ return nota(n, provP); };
    var L = [];
    var add = function(grp, code, q, note){
      if (note === undefined) note = '';
      if (q > 0.001 && PRECIOS[code]) L.push({grp:grp, code:code, q:Math.round(q*100)/100, note:note});
    };

    add('Trabajos previos','TP01',F*1.3,e('Terreno ≈ huella × 1,3')); add('Trabajos previos','TP02',A,e(''));
    add('Trabajos previos','TP08',Math.ceil(A/60),e('1 contenedor cada 60 m²'));
    if (A > 200) { add('Trabajos previos','TP03',12); add('Trabajos previos','TP05',P/4*2.2,eP('Vallado del frente')); }
    if (est === 'muros' && N <= 2){
      add('Estructura','EX01',P*1.6*0.36,eP('Zanjas muros exteriores e interiores'));
      add('Estructura','CI01',P*1.6*0.36,eP('')); add('Estructura','AL01',P*1.6*0.6,eP(''));
      add('Estructura','ES02',P*1.6*N,eP('Encadenados por nivel'));
      add('Estructura','ES03',Math.ceil(P/3.5)*3*N,eP('Pilares cada 3,5 m'));
    } else {
      var pil = Math.max(4, Math.round(F/12));
      add('Estructura','EX02',pil*2.2,e(pil + ' bases')); add('Estructura','ES01',pil*1.5,e(''));
      add('Estructura','ES02',P*1.5,eP('Vigas de fundación')); add('Estructura','ES03',pil*3.1*N,e(pil + ' pilares × ' + N + ' niveles'));
      var slabs = (N-1) + (tec === 'losa' ? 1 : 0);
      if (slabs > 0){ add('Estructura','ES05',F*slabs*0.04,e('Vigas ≈ 0,04 m³/m²')); add('Estructura','ES04',F*slabs*0.12,e('Losas 12 cm')); }
    }
    if (est === 'muros' && N > 1) add('Estructura','ES07',F*(N-1),e('Entrepisos losa Rap'));
    if (est === 'muros' && tec === 'losa') add('Techo','ES07',F,e('Losa Rap de techo'));
    if (N > 1){ add('Estructura','ES12',(N-1)*18,'Escalones'); add('Estructura','ES13',(N-1)*2.7); }
    var ext = med ? med.areaMurosExteriores : P*2.8*N, tot = A*2.1;
    var intr = med ? med.areaMurosInteriores : Math.max(tot-ext, 0);
    if (mur === 'hueco'){ add('Muros','AL18',ext,m('Muros exteriores')); add('Muros','AL17',intr,m('Tabiques interiores')); }
    else { add('Muros','AL09',ext,m('Muros exteriores 0,20')); add('Muros','AL04',intr,m('Tabiques 0,15')); }
    add('Muros','AI01',A*0.04,e('Aislación horizontal'));
    var rev = (ext+intr)*2;   // con medidas, 2 × mampostería medida
    add('Revoques','RV05',rev,m('Ambas caras')); add('Revoques','RV01',ext*0.5,'Azotada exterior');
    add('Contrapisos','CP01',med ? med.areaPiso : F,m('')); if (N > 1 || tec === 'losa') add('Contrapisos','CP02',F*(N-1) + (tec==='losa'?F:0),e(''));
    if (tec === 'losa'){ add('Techo','AI06',F*1.05,e('Membrana azotea')); add('Techo','AI12',F,e('')); }
    if (tec === 'teja'){ add('Techo','TE03',F*1.25,e('Faldones con alero')); add('Techo','AI09',F*1.25,e('')); }
    if (tec === 'chapa'){ add('Techo','TE13',F*1.2,e('')); }
    add('Pisos y revestimientos', pis==='por'?'PI16':'PI13', med ? med.areaPiso : A*0.92, m(''));
    add('Pisos y revestimientos','ZO01',med ? med.zocaloMl : A*0.5, m(''));
    var azul = med ? med.areaAzulejos : B*14+K*3;
    add('Pisos y revestimientos','RE03',azul,m('Baños 14 m², cocinas 3 m²'));
    var cieA = tec === 'teja' ? A - F : A;
    if (cieA > 0) add('Cielorrasos', cie==='yeso'?'CR03':'RV06', cieA*0.95, e(tec==='teja'?'Último nivel: tejuelón a la vista':''));
    add('Pintura','PT02',Math.max(rev - azul,0),m('')); add('Pintura','PT07',A*0.95,e(''));
    if (alt) add('Pintura','PT11',(rev-azul)*0.7,'Enduido interior');
    add('Aberturas', alt?'CA01':'CA14', U, 'Puerta de entrada por unidad');
    var pint = med ? Math.max((med.cantidadPuertas || 0) - 1, 0) : B + Math.ceil(A/22);
    if (alt){ add('Aberturas','CA15',pint*1.7,m(pint + ' puertas interiores')); add('Aberturas','CA19',pint,m(''));
              add('Aberturas','CA25',med ? med.areaVentanas : A*0.12,m('Ventanas ≈ 12% de la superficie')); }
    else { add('Aberturas','CA13',pint,m(pint + ' puertas interiores'));
           add('Aberturas','CA17',med ? med.cantidadVentanas : Math.ceil(A*0.12/1.65),m('Ventanas 1,50×1,10')); }
    if (K) add('Aberturas','CA09',med ? med.mesadaMl : K*1.6,m('Mesada + bajo mesada'));
    add('Inst. sanitaria', alt?'IS03':'IS01', B); add('Inst. sanitaria','IS05',K);
    add('Inst. sanitaria','IS09',P*1.2,eP('')); add('Inst. sanitaria','IS12',Math.max(2,Math.ceil(A/150)),e(''));
    if (des === 'pozo'){ add('Inst. sanitaria','IS06',Math.max(1,Math.ceil(U/2))); add('Inst. sanitaria','IS07',Math.max(1,Math.ceil(U/2))); }
    if (N > 1) add('Inst. sanitaria','IS16',4*N*3,'Bajadas pluviales');
    add('Artefactos', alt?'M0855':'M0857', B, 'Loza por baño'); add('Artefactos', alt?'M0835':'M0823', B, 'Grifería por baño');
    add('Artefactos','M0862',K); add('Artefactos','M0827',K); add('Artefactos','M0921',U,'Termocalefón por unidad');
    if (U > 2 || N > 2) add('Artefactos','M0893',Math.ceil(U*150/2000)+1,'Tanques 2.000 L');
    add('Inst. eléctrica','IE01',A/6,e('1 boca cada 6 m²')); add('Inst. eléctrica','IE02',A/5,e('1 toma cada 5 m²'));
    add('Inst. eléctrica','IE06',Math.max(U, Math.round(A/40)),e('Líneas de aire acondicionado')); add('Inst. eléctrica','IE07',U);
    add('Inst. eléctrica', A > 250 || U > 2 ? 'IE13' : 'IE12', 1); add('Inst. eléctrica','IE08',1);
    if (U > 1) add('Inst. eléctrica','IE10',U,'Tablero por unidad');
    if (A > 300) add('Inst. eléctrica','M0461',Math.ceil(A/150),e('Extintores'));
    // Redondeo final de gen(): centésimos por debajo de 10, enteros desde 10.
    return L.map(function(x){
      var f = x.q < 10 ? 100 : 1;
      return {grp:x.grp, code:x.code, q:Math.round(x.q*f)/f, note:x.note};
    });
  }

  function presupuestar(lineas, precios){
    precios = precios || PRECIOS;
    var renglones = [], total = 0;
    (lineas || []).forEach(function(l){
      var p = precios[l.code];
      if (!p) return;
      var t = Math.round(l.q * p.pu);
      renglones.push({grp:l.grp, code:l.code, desc:p.desc, un:p.un, cant:l.q, pu:p.pu, total:t, nota:l.note || ''});
      total += t;
    });
    return {renglones:renglones, total:total};
  }

  return {OPCIONES_POR_DEFECTO:OPCIONES_POR_DEFECTO, rubros:rubros, presupuestar:presupuestar};
});
