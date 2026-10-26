// Pantalla A de la demo «Cómputo desde plano»: une el editor con medidas, rubros y precios,
// el panel en vivo, el detalle, los modos de acceso y la carga de planos. Nada se envía por red:
// lo único que se descarga es pdf.js, y solo cuando se sube un PDF.
(function(){
  'use strict';
  var D = window.FugaComputoDatos, Mo = window.FugaModelo, R = window.FugaReglas, A = window.FugaAcceso, X = window.FugaDxf;
  var MARCA = 'DEMO FUGA';
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var ESCALA = {m:1, cm:0.01, mm:0.001};
  var MAX_SEGMENTOS = 15000;   // más líneas que esto congela la detección de muros (compara todos los pares)
  var MAX_MUROS = 300;         // más muros que esto no es una planta de vivienda: cortes, fachadas o mobiliario
  var ALTURA_MIN = 2, ALTURA_MAX = 6, ALTURA = 2.80;
  var TECHO = {teja:'TE03', chapa:'TE13', losa:'AI12'};   // renglón que da la superficie de techo del presupuesto
  var TXT = {
    dwg:'Guardalo como DXF desde AutoCAD (Archivo › Guardar como › DXF) y subilo de nuevo',
    sinMuros:'No encontramos muros en este DXF. Revisá que esté en espacio modelo, que la unidad sea la correcta (podés cambiarla en “Unidad”: m, cm o mm) y que los muros sean líneas o polilíneas (no bloques). También podés subirlo como PDF o imagen.',
    grande:'Este DXF es muy grande para la demo. Dejá solo la planta (sin cortes, fachadas ni mobiliario) y volvé a subirlo.',
    otraUnidad:function(u){ return 'Probamos con otra unidad (' + u + ') porque con la del archivo no aparecían muros. Podés cambiarla en “Unidad”.'; },
    inferidos:'Tomamos como exteriores los muros del contorno. Si no es así, marcalos con “Muro exterior”.',
    provisorio:'Total provisorio: marcá los ambientes (Ambiente) para medir pisos y superficie',
    nuevo:'Plano nuevo: dibujá los muros con la herramienta Muro (las medidas van en metros). Deshacer trae de vuelta el plano anterior.',
    bloques:'Si tus muros están dentro de bloques, explotalos antes de guardar el DXF.',
    escaleras:'Revisá escaleras o muebles dibujados con doble línea: pueden aparecer como muros.',
    propuestos:'Los muros y aberturas propuestos se ven en amarillo: corregí los que hagan falta (clic para editar, Supr para borrar) y tocá «Confirmar todo». Después marcá los ambientes con la herramienta Ambiente.',
    escala:'Marcá dos puntos de una medida conocida (por ejemplo, una cota) y escribí la distancia real. Después dibujá muros, aberturas y ambientes encima.',
    formato:'Ese formato no se puede leer. Subí un DXF, PDF, JPG o PNG.',
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
  ['detalle', 'aviso-bajar'].forEach(function(id){
    $(id).addEventListener('click', function(e){ if (e.target === $(id) || e.target.closest('[data-cerrar]')) cerrar(id); });
  });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape'){ cerrar('detalle'); cerrar('aviso-bajar'); } });
  ['detalle', 'panel'].forEach(function(id){
    ['copy', 'cut', 'contextmenu', 'selectstart'].forEach(function(t){ $(id).addEventListener(t, function(e){ e.preventDefault(); }); });
  });

  // ---- barra de herramientas ----
  document.querySelectorAll('.herr [data-h]').forEach(function(b){ b.addEventListener('click', function(){ editor.herramienta(b.dataset.h); }); });
  $('deshacer').addEventListener('click', function(){ editor.deshacer(); });
  $('nuevo').addEventListener('click', function(){   // vacía muros, aberturas, ambientes y fondo; se puede deshacer
    if (modo !== 'activo') return;
    dxf = null; editor.nuevo(); editor.herramienta('muro'); avisar([TXT.nuevo]);
  });
  $('exterior').addEventListener('change', function(){ editor.exterior(this.checked); });
  $('confirmar').addEventListener('click', function(){ editor.confirmarPropuestos(); });
  $('z-mas').addEventListener('click', function(){ editor.zoom(1.25); });
  $('z-menos').addEventListener('click', function(){ editor.zoom(0.8); });
  $('z-todo').addEventListener('click', function(){ editor.encuadrar(); });

  // ---- avisos ----
  function avisar(lista, unidad){
    var t = $('avisos-texto'); t.textContent = '';
    lista.forEach(function(x){
      var p = document.createElement('p');
      if (Array.isArray(x)){ p.className = x[0]; p.textContent = x[1]; } else p.textContent = x;
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
    if (ext === 'dwg') return avisar([['error', TXT.dwg]]);
    if (ext === 'dxf'){ avisar(['Leyendo el DXF…']); return leer(f, 'readAsText').then(cargarDxf).catch(function(){ avisar([['error', TXT.sinMuros]]); }); }
    if (ext === 'pdf') return cargarPdf(f);
    if (/^(png|jpe?g)$/.test(ext)) return leer(f, 'readAsDataURL').then(cargarImagen).catch(function(){ avisar([['error', TXT.formato]]); });
    avisar([['error', TXT.formato]]);
  }
  var dxf = null;   // segmentos en metros con la unidad elegida
  function reescalar(segs, de, a){   // segmentos leídos en la unidad «de» → como si el DXF estuviera en «a»
    var k = ESCALA[a] / ESCALA[de];
    return segs.map(function(s){ return {a:[s.a[0]*k, s.a[1]*k], b:[s.b[0]*k, s.b[1]*k], capa:s.capa}; });
  }
  function cargarDxf(texto){
    var r = X.leerDxf(texto);
    if (r.segmentos.length > MAX_SEGMENTOS){ dxf = null; return avisar([['error', TXT.grande]]); }
    dxf = {segs:r.segmentos, unidad:r.unidad};
    var plano = dxf.segs.length ? X.detectarPlano(dxf.segs) : null, otra = null;
    if (plano && !plano.muros.length){   // 0 muros: se prueba con m, cm y mm y queda la que da más muros (sin pasar el tope)
      ['m', 'cm', 'mm'].forEach(function(u){
        if (u === r.unidad) return;
        var segs = reescalar(r.segmentos, r.unidad, u), pl = X.detectarPlano(segs);
        if (pl.muros.length > plano.muros.length && pl.muros.length <= MAX_MUROS){ plano = pl; otra = {segs:segs, unidad:u}; }
      });
      if (otra) dxf = otra;
    }
    procesarDxf(plano, otra ? [TXT.otraUnidad(otra.unidad)] : []);
  }
  function procesarDxf(plano, extra){
    plano = plano || (dxf.segs.length ? X.detectarPlano(dxf.segs) : {muros:[], aberturas:[]});
    if (plano.muros.length > MAX_MUROS) return avisar([['error', TXT.grande]], dxf.unidad);
    editor.cargar({muros:plano.muros, aberturas:plano.aberturas, ambientes:[]});
    editor.fondoLineas(dxf.segs);
    editor.herramienta('seleccionar');
    if (!plano.muros.length) avisar([['error', TXT.sinMuros]], dxf.segs.length ? dxf.unidad : null);
    else avisar((extra || []).concat([plano.muros.length + ' muros y ' + plano.aberturas.length + ' aberturas propuestos. ' + TXT.propuestos, TXT.bloques, TXT.escaleras]), dxf.unidad);
  }
  $('unidad-sel').addEventListener('change', function(){   // unidad corregida a mano: se vuelve a leer con esa escala
    if (!dxf) return;
    dxf.segs = reescalar(dxf.segs, dxf.unidad, this.value);
    dxf.unidad = this.value;
    try { procesarDxf(); } catch (e) { avisar([['error', TXT.sinMuros]], dxf.unidad); }
  });
  function cargarImagen(url){
    return new Promise(function(ok, mal){
      var img = new Image();
      img.onload = function(){
        dxf = null;
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
  function cargarPdf(f){
    avisar(['Leyendo el PDF…']);
    return Promise.all([cargarPdfjs(), leer(f, 'readAsArrayBuffer')]).then(function(x){
      return x[0].getDocument({data:new Uint8Array(x[1]), isEvalSupported:false}).promise;   // CVE-2024-4367
    }).then(function(doc){ return doc.getPage(1); }).then(function(pag){
      var v1 = pag.getViewport({scale:1}), k = Math.min(4, 2400 / Math.max(v1.width, v1.height));
      var v = pag.getViewport({scale:k}), c = document.createElement('canvas');
      c.width = Math.round(v.width); c.height = Math.round(v.height);
      var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      return pag.render({canvasContext:ctx, viewport:v}).promise.then(function(){ return cargarImagen(c.toDataURL('image/png')); });
    }).catch(function(){ avisar([['error', TXT.pdf]]); });
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
        document.querySelectorAll('.barra, main, #avisos, #aviso-ejemplo').forEach(function(el){ el.inert = true; });
      }
      else $('aviso-ejemplo').hidden = false;
    }
    calcular();
    $('ver-detalle').disabled = false;
  }
  iniciar();
})();
