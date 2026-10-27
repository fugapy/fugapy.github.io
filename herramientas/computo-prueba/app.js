// Pantalla A de la demo «Cómputo desde plano»: une el editor con medidas, rubros y precios,
// el panel en vivo, el detalle, los modos de acceso y la carga de planos. El plano no sale de la compu: el DWG y el DXF se
// leen en un Web Worker (trabajador.js); lo único que se descarga es LibreDWG (al subir un DWG) o pdf.js (al subir un PDF).
(function(){
  'use strict';
  var D = window.FugaComputoDatos, Mo = window.FugaModelo, R = window.FugaReglas, A = window.FugaAcceso, S = window.FugaSelector;
  var MARCA = 'DEMO FUGA';
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var MAX_BYTES = 60 * 1024 * 1024;   // tope por archivo (el mismo de dwg.js): se mira antes de leerlo
  var MAX_MUROS = 300;         // por dibujo: más muros que esto no es una planta de vivienda (cortes, fachadas o mobiliario)
  var PLAZO = 25000;           // ms: tiempo máximo del Worker para leer y separar el plano (regla 5)
  var PLAZO_BAJADA = 120000;   // ms: la primera bajada de LibreDWG (10,8 MB) tiene su propio plazo; los 25 s corren después
  var ALTURA_MIN = 2, ALTURA_MAX = 6, ALTURA = 2.80;
  var TECHO = {teja:'TE03', chapa:'TE13', losa:'AI12'};   // renglón que da la superficie de techo del presupuesto
  var TXT = {
    sinMuros:'No encontramos muros en este plano. Revisá que esté en espacio modelo y que la unidad sea la correcta (podés cambiarla en “Unidad”: m, cm o mm). También podés subirlo como PDF o imagen.',
    errores:{   // un texto por código de error del Worker (dwg.js); «interno» es también el del tiempo máximo
      binario:'Este DXF está guardado en formato binario. Guardalo como DXF de texto (ASCII) desde AutoCAD y subilo de nuevo.',
      vacio:'El archivo está vacío o no tiene nada dibujado en el espacio modelo. Revisá que sea el plano, o subilo como PDF o imagen.',
      dwg_viejo:'No pudimos leer este DWG: es anterior a AutoCAD R13, está dañado o es de una versión que el lector no soporta. Guardalo como DXF desde AutoCAD (Archivo › Guardar como › DXF) y subilo de nuevo.',
      dwg_cdn:'No pudimos bajar el lector de DWG. Revisá tu conexión y probá de nuevo, o guardalo como DXF desde AutoCAD y subilo.',
      grande:'Este archivo es muy grande para la demo (más de 60 MB o más de lo que aguanta el navegador). Exportá solo la planta y volvé a subirlo.',
      interno:'No pudimos leer este plano. Probá exportar solo la planta, o subilo como PDF o imagen'
    },
    progreso:{bajando:'Bajando el lector de DWG (una sola vez)…', leyendo:'Leyendo el plano…', muros:'Buscando muros…', dibujos:'Separando dibujos…'},
    notas:{   // avisos de la lectura, por clave de FugaSelector.notas
      cortado:'El archivo es muy grande: leímos solo una parte. Si falta algo, exportá solo la planta.',
      bloques:'Algunos bloques no se pudieron leer (faltan, se insertan a sí mismos o tienen una escala imposible): revisá que no falten muros.',
      extrusion:'Algunas líneas están dibujadas en otro plano (3D) y no se leyeron.',
      una_linea:'Muros de una línea: revisá los espesores.'
    },
    usamosPlanta:function(n){ return 'Usamos la planta. Ignoramos ' + n + (n === 1 ? ' dibujo que no es planta' : ' dibujos que no son planta'); },
    otroDibujo:'Tu archivo tiene otros dibujos',
    elegi:'Elegí la planta en la lista de dibujos',
    dibujoGrande:'demasiado grande para la demo',
    inferidos:'Tomamos como exteriores los muros del contorno. Si no es así, marcalos con “Muro exterior”.',
    provisorio:'Total provisorio: marcá los ambientes (Ambiente) para medir pisos y superficie',
    nuevo:'Plano nuevo: dibujá los muros con la herramienta Muro (las medidas van en metros). Deshacer trae de vuelta el plano anterior.',
    calcar:'Las líneas del archivo quedan de fondo: podés marcar los muros a mano con la herramienta Muro.',
    mano:'Dibujá los muros con la herramienta Muro sobre el plano de fondo (las medidas van en metros). Deshacer trae de vuelta el plano anterior.',
    escaleras:'Revisá escaleras o muebles dibujados con doble línea: pueden aparecer como muros.',
    propuestos:'Los muros y aberturas propuestos se ven en amarillo: corregí los que hagan falta (clic para editar, Supr para borrar) y tocá «Confirmar todo». Después marcá los ambientes con la herramienta Ambiente.',
    escala:'Marcá dos puntos de una medida conocida (por ejemplo, una cota) y escribí la distancia real. Después dibujá muros, aberturas y ambientes encima.',
    formato:'Ese formato no se puede leer. Subí un DWG, DXF, PDF, JPG o PNG.',
    pdf:'No pudimos leer el PDF. Probá exportar la planta como imagen (JPG o PNG) y subila.'
  };
  var TIPOS_AMB = {bano:'Baño', cocina:'Cocina', lavadero:'Lavadero', dormitorio:'Dormitorio', estar:'Estar', exterior:'Exterior', otro:'Otro'};
  var TIPOS_ABE = {puerta:'Puerta', puerta_corrediza:'Puerta corrediza', paso:'Paso (sin hoja)', ventana:'Ventana',
                   ventana_corrediza:'Ventana corrediza', ventana_banderola:'Ventana banderola'};
  var $ = function(id){ return document.getElementById(id); };
  var gs = function(v){ return 'Gs. ' + Math.round(v || 0).toLocaleString('es-PY'); };
  var dec = function(v){ return (v || 0).toLocaleString('es-PY', {minimumFractionDigits:2, maximumFractionDigits:2}); };
  var cant = function(v){ return (v || 0).toLocaleString('es-PY', {maximumFractionDigits:2}); };
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return '&#' + c.charCodeAt(0) + ';'; }); }
  function area(p){
    p = p || []; var n = p.length, s = 0;
    if (n > 1 && p[0][0] === p[n-1][0] && p[0][1] === p[n-1][1]) p = p.slice(0, --n);
    for (var i = 0; i < n; i++){ var q = p[(i+1) % n]; s += p[i][0]*q[1] - q[0]*p[i][1]; }
    return Math.abs(s) / 2;
  }

  // ---- marca de agua: mosaico «DEMO FUGA» en CSS (computo.css, .marca); acá solo se rotula la capa ----
  document.querySelectorAll('.marca').forEach(function(m){ m.setAttribute('data-texto', MARCA); });

  // ---- editor y cálculo en vivo ----
  var ultimo = null, modo = 'ejemplo';
  var editor = FugaEditor.crear($('plano'), {
    onCambio:function(){ calcular(); },
    onPista:function(t){ $('pista').textContent = t; },
    onHerramienta:function(h){
      document.querySelectorAll('.herr [data-h]').forEach(function(b){ b.setAttribute('aria-pressed', String(b.dataset.h === h)); });
    }
  });
  function opciones(){
    var o = {};
    Object.keys(R.OPCIONES_POR_DEFECTO).forEach(function(k){ o[k] = $('p-' + k).value; });
    return o;
  }
  function altura(){   // entre 2 y 6 m; vacío o inválido → 2,80
    var h = Number(String($('altura').value).replace(',', '.'));
    return h > 0 ? Math.min(ALTURA_MAX, Math.max(ALTURA_MIN, h)) : ALTURA;
  }
  function calcular(){
    var modelo = editor.modelo();
    var med = Mo.medir(modelo, {alturaMuros:altura()});
    var par = Object.assign({m2:med.superficieConstruida, niv:1, uni:1, ban:med.banos, coc:med.cocinas}, opciones());
    var p = R.presupuestar(R.rubros(par, med), D.PRECIOS);
    ultimo = {modelo:modelo, med:med, p:p};
    $('r-sup').textContent = dec(med.superficieConstruida) + ' m²';
    $('r-mur').textContent = dec(med.areaMuros) + ' m²';
    $('r-pint').textContent = dec(med.pinturaInterior) + ' m²';
    $('r-pext').textContent = dec(med.pinturaExterior) + ' m²';
    var pasos = med.aberturas.length - med.cantidadPuertas - med.cantidadVentanas;
    $('r-abe').textContent = String(med.aberturas.length);
    $('r-abe-d').textContent = med.aberturas.length ? med.cantidadPuertas + ' puertas · ' + med.cantidadVentanas + ' ventanas' +
      (pasos > 0 ? ' · ' + pasos + ' pasos u otras' : '') : '';
    $('r-total').textContent = gs(p.total);
    var nota = [];
    if (!modelo.muros.length) nota.push('Dibujá los muros y marcá los ambientes para ver el cómputo.');
    else if (!(med.areaPiso > 0)) nota.push(TXT.provisorio);
    if (med.exterioresInferidos) nota.push(TXT.inferidos);
    $('r-nota').textContent = nota.join('\n'); $('r-nota').hidden = !nota.length;   // una nota por línea (#r-nota: pre-line)
    $('confirmar').hidden = !modelo.muros.concat(modelo.aberturas).some(function(x){ return x.propuesto; }) || modo !== 'activo';
    if (!$('detalle').hidden) detalle();
  }
  Object.keys(R.OPCIONES_POR_DEFECTO).forEach(function(k){
    var s = $('p-' + k); s.value = R.OPCIONES_POR_DEFECTO[k]; s.addEventListener('change', calcular);
  });
  $('altura').addEventListener('input', calcular);
  $('altura').addEventListener('change', function(){ this.value = altura().toFixed(2); calcular(); });   // muestra el valor acotado

  // ---- detalle agrupado por rubro (como el presupuestador), con su marca de agua ----
  function detalle(){
    var p = ultimo.p, m = ultimo.modelo, med = ultimo.med, h = [];
    var muros = {}; m.muros.forEach(function(w){ muros[w.id] = true; });
    var techo = p.renglones.filter(function(r){ return r.code === TECHO[$('p-tec').value]; })[0];
    var amb = m.ambientes.map(function(a){
      return '<tr><td class="d">' + esc(a.nombre || '—') + '<small>' + esc(TIPOS_AMB[a.tipo] || a.tipo) + '</small></td><td class="num">' + dec(area(a.poligono)) + '</td></tr>';
    }).join('');
    var plan = {};
    m.aberturas.forEach(function(o){
      if (!muros[o.muro]) return;
      var k = o.tipo + '|' + dec(o.ancho) + ' × ' + dec(o.alto);
      plan[k] = (plan[k] || 0) + 1;
    });
    var abe = Object.keys(plan).sort().map(function(k){
      var t = k.split('|');
      return '<tr><td class="d">' + esc(TIPOS_ABE[t[0]] || t[0]) + '</td><td class="num">' + t[1] + '</td><td class="num">' + plan[k] + '</td></tr>';
    }).join('');
    h.push('<div class="dos"><div><h3>Superficies</h3><table><tbody>' +
      '<tr><td class="d">Superficie construida<small>pisos cubiertos + muros</small></td><td class="num">' + dec(med.superficieConstruida) + '</td></tr>' +
      '<tr><td class="d">Superficie de techo<small>' + (techo ? esc(techo.code) + ' · la misma del presupuesto' : 'sin techo en el presupuesto') + '</small></td><td class="num">' + dec(techo ? techo.cant : 0) + '</td></tr>' +
      amb + '</tbody></table></div>' +
      '<div><h3>Planilla de aberturas</h3><table><thead><tr><th class="d">Tipo</th><th>Medida (m)</th><th>Cant.</th></tr></thead><tbody>' +
      (abe || '<tr><td class="d" colspan="3">Sin aberturas</td></tr>') + '</tbody></table>' +
      '<h3>Pintura</h3><table><tbody><tr><td class="d">Interior</td><td class="num">' + dec(med.pinturaInterior) + ' m²</td></tr>' +
      '<tr><td class="d">Exterior</td><td class="num">' + dec(med.pinturaExterior) + ' m²</td></tr></tbody></table></div></div>');
    var sub = {}; p.renglones.forEach(function(r){ sub[r.grp] = (sub[r.grp] || 0) + r.total; });
    var filas = '', g = null;
    p.renglones.forEach(function(r){
      if (r.grp !== g){ g = r.grp; filas += '<tr class="grp"><td colspan="4">' + esc(g) + '</td><td class="num">' + Math.round(sub[g]).toLocaleString('es-PY') + '</td></tr>'; }
      filas += '<tr><td class="d">' + esc(r.desc) + '<small>' + esc(r.code) + (r.nota ? ' · ' + esc(r.nota) : '') + '</small></td>' +
        '<td class="num">' + cant(r.cant) + '</td><td>' + esc(r.un) + '</td><td class="num">' + Math.round(r.pu).toLocaleString('es-PY') +
        '</td><td class="num">' + Math.round(r.total).toLocaleString('es-PY') + '</td></tr>';
    });
    if (!filas) filas = '<tr><td class="d" colspan="5">Todavía no hay rubros: dibujá muros y marcá ambientes.</td></tr>';
    h.push('<h3>Rubros · ' + p.renglones.length + ' renglones · ' + esc(D.BASE) + '</h3><div class="tablewrap"><table>' +
      '<thead><tr><th class="d">Ítem</th><th>Cant.</th><th>Un</th><th>P.U.</th><th>Total</th></tr></thead><tbody>' + filas +
      '<tr class="tot"><td class="d" colspan="4">Total · costo directo, sin recargo</td><td class="num">' + gs(p.total) + '</td></tr></tbody></table></div>');
    $('detalle-cuerpo').innerHTML = h.join('');
  }
  function abrir(id){ $(id).hidden = false; var b = $(id).querySelector('[data-cerrar]'); if (b) b.focus(); }
  function cerrar(id){ $(id).hidden = true; }
  $('ver-detalle').addEventListener('click', function(){ if (!ultimo) calcular(); detalle(); abrir('detalle'); });
  $('bajar').addEventListener('click', function(){ abrir('aviso-bajar'); });   // no baja nada: solo el aviso con el WhatsApp
  ['detalle', 'aviso-bajar', 'selector'].forEach(function(id){
    $(id).addEventListener('click', function(e){ if (e.target === $(id) || e.target.closest('[data-cerrar]')) cerrar(id); });
  });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape'){ cerrar('detalle'); cerrar('aviso-bajar'); cerrar('selector'); } });
  ['detalle', 'panel'].forEach(function(id){
    ['copy', 'cut', 'contextmenu', 'selectstart'].forEach(function(t){ $(id).addEventListener(t, function(e){ e.preventDefault(); }); });
  });

  // ---- barra de herramientas ----
  document.querySelectorAll('.herr [data-h]').forEach(function(b){ b.addEventListener('click', function(){ editor.herramienta(b.dataset.h); }); });
  $('deshacer').addEventListener('click', function(){ editor.deshacer(); });
  $('nuevo').addEventListener('click', function(){   // vacía muros, aberturas, ambientes y fondo; se puede deshacer
    if (modo !== 'activo') return;
    cancelarLectura(); cad = null; editor.nuevo(); editor.herramienta('muro'); avisar([TXT.nuevo]);
  });
  $('exterior').addEventListener('change', function(){ editor.exterior(this.checked); });
  $('confirmar').addEventListener('click', function(){ editor.confirmarPropuestos(); });
  $('z-mas').addEventListener('click', function(){ editor.zoom(1.25); });
  $('z-menos').addEventListener('click', function(){ editor.zoom(0.8); });
  $('z-todo').addEventListener('click', function(){ editor.encuadrar(); });

  // ---- avisos: cada ítem es un texto, [clase, texto] o {ver:texto} (texto + enlace «Ver dibujos», que abre el selector) ----
  function avisar(lista, unidad){
    var t = $('avisos-texto'); t.textContent = '';
    lista.forEach(function(x){
      var p = document.createElement('p');
      if (Array.isArray(x)){ p.className = x[0]; p.textContent = x[1]; }
      else if (x && x.ver){
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'enlace'; b.textContent = 'Ver dibujos';
        b.addEventListener('click', abrirSelector);
        p.append(x.ver + ' (', b, ')');
      }
      else p.textContent = x;
      t.appendChild(p);
    });
    $('unidad').hidden = !unidad;
    if (unidad){ $('unidad-txt').textContent = unidad; $('unidad-sel').value = unidad; }
    $('avisos').hidden = !lista.length;
  }
  $('avisos-cerrar').addEventListener('click', function(){ $('avisos').hidden = true; });

  // ---- subir plano: todo se lee en este navegador ----
  function leer(f, como){
    return new Promise(function(ok, mal){
      var r = new FileReader();
      r.onload = function(){ ok(r.result); }; r.onerror = function(){ mal(r.error); };
      r[como](f);
    });
  }
  $('subir').addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); $('archivo').click(); } });
  $('archivo').addEventListener('change', function(){
    var f = this.files && this.files[0]; this.value = '';
    if (f && modo === 'activo') subir(f);
  });
  function subir(f){
    var ext = (String(f.name).split('.').pop() || '').toLowerCase();
    cancelarLectura(); cerrar('selector');
    var mio = turno;   // un PDF o una imagen que terminan después de otra subida (o de «Plano nuevo») se ignoran
    if (f.size > MAX_BYTES){ return avisar([['error', TXT.errores.grande]]); }
    if (ext === 'dwg' || ext === 'dxf'){ cad = {archivo:f, unidad:null, res:null}; return leerCad(); }
    if (ext === 'pdf') return cargarPdf(f, mio);
    if (/^(png|jpe?g)$/.test(ext)) return leer(f, 'readAsDataURL').then(function(url){ return cargarImagen(url, mio); })
      .catch(function(){ if (mio === turno) avisar([['error', TXT.formato]]); });
    avisar([['error', TXT.formato]]);
  }

  // ---- DWG y DXF: se leen en el Worker (trabajador.js), con progreso y tiempo máximo ----
  // Si el Worker falla, se pasa de tiempo o devuelve un error, se termina (terminate) y el próximo archivo usa uno nuevo:
  // un WASM trabado no contamina la lectura siguiente.
  var cad = null;   // último DWG/DXF: {archivo, unidad (forzada o null), res (lo de planos.analizar)}
  var trabajador = null, ocupado = false, turno = 0, reloj = null, lectorBajado = false;
  // LibreDWG vive en cada Worker: al soltarlo, el próximo DWG lo vuelve a cargar (con el plazo de bajada y su aviso).
  function soltarTrabajador(){ if (trabajador){ trabajador.terminate(); trabajador = null; } lectorBajado = false; }
  function cancelarLectura(){   // una subida nueva, «Plano nuevo» o un error: lo que llegue del pedido anterior se ignora
    turno++; clearTimeout(reloj);
    if (ocupado){ ocupado = false; soltarTrabajador(); }
  }
  function leerCad(){
    cancelarLectura();
    var mio = turno, c = cad;
    var plazo = function(ms){ clearTimeout(reloj); reloj = setTimeout(function(){ terminar(mio, {tipo:'error', codigo:'interno'}, c); }, ms); };
    avisar([TXT.progreso.leyendo]);
    ocupado = true; plazo(PLAZO);
    leer(c.archivo, 'readAsArrayBuffer').then(function(bytes){
      if (mio !== turno) return;
      if (!trabajador) trabajador = new Worker('trabajador.js', {type:'module'});
      trabajador.onmessage = function(ev){
        var m = ev.data || {};
        if (mio !== turno) return;
        if (m.tipo !== 'progreso') return terminar(mio, m, c);
        if (m.etapa === 'carga' && !lectorBajado) plazo(m.f >= 1 ? PLAZO : PLAZO_BAJADA);
        if (m.etapa === 'carga' && m.f >= 1) lectorBajado = true;
        avisar([TXT.progreso[S.etapa(m.etapa, lectorBajado)]]);
      };
      trabajador.onerror = trabajador.onmessageerror = function(e){ if (e && e.preventDefault) e.preventDefault(); terminar(mio, {tipo:'error', codigo:'interno'}, c); };
      var clave = [c.archivo.name, c.archivo.size, c.archivo.lastModified].join('|');   // misma clave: el Worker no vuelve a decodificar (Cambiar unidad)
      trabajador.postMessage({nombre:c.archivo.name, bytes:bytes, unidad:c.unidad || undefined, unaLinea:true, clave:clave}, [bytes]);   // una sola lectura: planos.js solo usa muros de una línea en capas de muros sin pares
    }).catch(function(){ terminar(mio, {tipo:'error', codigo:'interno'}, c); });
  }
  function terminar(mio, m, c){   // c: el archivo de este pedido (cad puede haber cambiado)
    if (mio !== turno) return;
    clearTimeout(reloj); ocupado = false;
    if (m.tipo !== 'listo' || !m.resultado){ soltarTrabajador(); if (cad === c) cad = null; return avisar([['error', TXT.errores[m.codigo] || TXT.errores.interno]]); }
    cad = c;
    var res = c.res = m.resultado, dib = res.dibujos || [];
    if (!dib.length){   // sin muros: las líneas del archivo quedan de fondo para dibujarlos a mano
      editor.cargar({}); editor.fondoLineas(res.fondo); editor.herramienta('muro');
      return avisar([['error', TXT.sinMuros]].concat(res.fondo && res.fondo.length ? [TXT.calcar] : [], notas(res)), res.unidad);
    }
    var i = S.inicial(dib, MAX_MUROS);
    if (i >= 0) elegir(i, true);
    else { avisar(notas(res).concat([{ver:TXT.elegi}]), res.unidad); abrirSelector(); }
  }
  function notas(res){ return S.notas(res).map(function(k){ return TXT.notas[k]; }); }
  function elegir(i, directo){   // carga el dibujo i en el editor, como antes un DXF: muros y aberturas propuestos sobre su fondo
    var res = cad.res, d = res.dibujos[i], otros = res.dibujos.length - 1;
    cerrar('selector');
    editor.cargar({muros:d.muros, aberturas:d.aberturas, ambientes:[]});
    editor.fondoLineas(d.fondo);
    editor.herramienta('seleccionar');
    var l = otros > 0 ? [{ver:directo ? TXT.usamosPlanta(otros) : TXT.otroDibujo}] : [];
    avisar(l.concat([d.muros.length + ' muros y ' + d.aberturas.length + ' aberturas propuestos. ' + TXT.propuestos, TXT.escaleras], notas(res)), res.unidad);
  }
  function abrirSelector(){
    if (!cad || !cad.res) return;
    $('selector-lista').innerHTML = cad.res.dibujos.map(function(d, i){
      var x = S.describir(d, i, MAX_MUROS);
      return '<button type="button" class="dib ' + (x.planta ? 'es-planta' : 'no-planta') + '" data-i="' + i + '"' + (x.grande ? ' disabled' : '') + '>' +
        S.miniatura(d) + '<span class="dib-t">' + esc(x.titulo) + (x.planta ? ' <em class="tag">planta</em>' : '') + '</span>' +
        '<small>' + esc(x.medida) + (x.laminas ? ' · ' + esc(x.laminas) : '') + '</small>' +
        (x.grande ? '<small class="grande">' + esc(TXT.dibujoGrande) + '</small>' : '') + '</button>';
    }).join('');
    $('selector-unidad-txt').textContent = cad.res.unidad;
    $('selector-unidad-sel').value = cad.res.unidad;
    $('selector-unidad-sel').hidden = true; $('selector-unidad').hidden = false;
    abrir('selector');
  }
  $('selector-lista').addEventListener('click', function(e){
    var b = e.target.closest('button.dib');
    if (b && !b.disabled) elegir(Number(b.dataset.i), false);
  });
  $('selector-mano').addEventListener('click', function(){   // ninguna sirve: sin muros, con el archivo de fondo para calcar (se puede deshacer)
    cerrar('selector'); editor.nuevo(); editor.fondoLineas(cad.res.fondo); editor.herramienta('muro');
    avisar([TXT.mano, {ver:TXT.otroDibujo}]);
  });
  $('selector-unidad').addEventListener('click', function(){ this.hidden = true; $('selector-unidad-sel').hidden = false; $('selector-unidad-sel').focus(); });
  function cambiarUnidad(){   // unidad corregida a mano: el Worker vuelve a leer el archivo con esa unidad forzada
    if (!cad) return;
    cad.unidad = this.value;
    cerrar('selector'); leerCad();
  }
  $('unidad-sel').addEventListener('change', cambiarUnidad);
  $('selector-unidad-sel').addEventListener('change', cambiarUnidad);
  function cargarImagen(url, mio){
    return new Promise(function(ok, mal){
      var img = new Image();
      img.onload = function(){
        if (mio !== turno) return ok();   // llegó otra subida mientras tanto
        cad = null;
        editor.cargar({});
        editor.fondo(url, img.naturalWidth, img.naturalHeight);
        editor.herramienta('escala');
        avisar([TXT.escala]);
        ok();
      };
      img.onerror = mal;
      img.src = url;
    });
  }
  var pdfjs = null;
  function cargarPdfjs(){   // pdf.js 3.11.174 desde cdnjs, solo cuando se sube un PDF
    if (!pdfjs) pdfjs = new Promise(function(ok, mal){
      var s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.onload = function(){ window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(window.pdfjsLib); };
      s.onerror = function(){ pdfjs = null; mal(new Error('pdf.js')); };
      document.head.appendChild(s);
    });
    return pdfjs;
  }
  function cargarPdf(f, mio){
    avisar(['Leyendo el PDF…']);
    return Promise.all([cargarPdfjs(), leer(f, 'readAsArrayBuffer')]).then(function(x){
      if (mio !== turno) throw null;   // llegó otra subida mientras tanto
      return x[0].getDocument({data:new Uint8Array(x[1]), isEvalSupported:false}).promise;   // CVE-2024-4367
    }).then(function(doc){ return doc.getPage(1); }).then(function(pag){
      var v1 = pag.getViewport({scale:1}), k = Math.min(4, 2400 / Math.max(v1.width, v1.height));
      var v = pag.getViewport({scale:k}), c = document.createElement('canvas');
      c.width = Math.round(v.width); c.height = Math.round(v.height);
      var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      return pag.render({canvasContext:ctx, viewport:v}).promise.then(function(){ return cargarImagen(c.toDataURL('image/png'), mio); });
    }).catch(function(){ if (mio === turno) avisar([['error', TXT.pdf]]); });
  }

  // ---- modos de acceso ----
  var almacen = {
    get:function(k){ try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set:function(k, v){ try { window.localStorage.setItem(k, v); } catch (e) {} }
  };
  var movil = window.matchMedia('(max-width: 760px)');
  movil.addEventListener('change', function(){ if (modo === 'activo') editor.bloquear(movil.matches); });
  async function iniciar(){
    var c = new URLSearchParams(location.search).get('c'), codigo = null;
    if (c) { try { codigo = await A.leerCodigo(c); } catch (e) { codigo = null; } }
    var est = A.estado(codigo, new Date(), almacen);
    modo = est.modo;
    document.body.classList.remove('modo-cargando');
    document.body.classList.add('modo-' + modo);
    editor.cargar(Mo.normalizar(D.EJEMPLO));   // Casa Patio: en ejemplo, y en activo para ver cómo funciona
    if (modo === 'activo'){
      var n = est.diasRestantes;
      $('cabecera').textContent = 'Demo para ' + est.nombre + ' · ' + (n === 1 ? 'queda 1 día' : 'quedan ' + n + ' días');
      $('cabecera').hidden = false;
      editor.bloquear(movil.matches);
    } else {
      document.body.classList.add('solo-ver');
      $('archivo').disabled = true;
      editor.bloquear(true);
      if (modo === 'vencido'){   // nada detrás del aviso se alcanza con Tab
        $('vencida').hidden = false;
        document.querySelectorAll('.barra, main, #avisos, #aviso-ejemplo, .pie').forEach(function(el){ el.inert = true; });
      }
      else $('aviso-ejemplo').hidden = false;
    }
    calcular();
    $('ver-detalle').disabled = false;
  }
  iniciar();
})();
