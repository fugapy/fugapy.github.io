// Editor SVG del plano para la demo «Cómputo desde plano». Solo edición: no calcula ni guarda nada.
// FugaEditor.crear(svg, {onCambio(modelo), onPista(texto), onHerramienta(nombre)}) →
//   {cargar(modelo), modelo(), fondo(url, anchoPx, altoPx), fondoLineas(segmentos), escala(metrosPorPx),
//    herramienta(nombre), deshacer(), nuevo(), confirmarPropuestos(), bloquear(si), exterior(si), encuadrar(), zoom(factor)}
// El modelo va en metros con y hacia arriba (como el CAD); en el SVG se dibuja con Y = -y.
(function(root){
  'use strict';
  var GRILLA = 0.05, PILA = 50, TOL_PX = 8, IMAN_PX = 10, RASTREO_PX = 10;
  var NUEVA = {puerta:{ancho:0.80, alto:2.10, tipo:'puerta'}, ventana:{ancho:1.20, alto:1.10, tipo:'ventana'}};
  var TIPOS_ABE = [['puerta','Puerta'],['puerta_corrediza','Puerta corrediza'],['paso','Paso (sin hoja)'],
                   ['ventana','Ventana'],['ventana_corrediza','Ventana corrediza'],['ventana_banderola','Ventana banderola']];
  var TIPOS_AMB = [['bano','Baño'],['cocina','Cocina'],['lavadero','Lavadero'],['dormitorio','Dormitorio'],
                   ['estar','Estar'],['exterior','Exterior'],['otro','Otro']];
  var PISTAS = {
    seleccionar:'Clic en un muro, abertura o ambiente para editarlo · Supr borra · arrastrá para mover la vista · rueda: zoom',
    muro:'Clic en el inicio y clic en el final del muro · la línea punteada alinea con otros muros · Shift: ángulo libre · Esc termina',
    puerta:'Clic sobre un muro para poner una puerta de 0,80 × 2,10',
    ventana:'Clic sobre un muro para poner una ventana de 1,20 × 1,10',
    ambiente:'Clic en cada esquina y doble clic para cerrar el ambiente',
    escala:'Marcá dos puntos de una medida conocida',
    bloqueado:'Arrastrá para mover la vista · rueda: zoom'
  };

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return '&#' + c.charCodeAt(0) + ';'; }); }
  function r4(v){ return Math.round(v * 1e4) / 1e4; }
  function grilla(v){ return Math.round(Math.round(v / GRILLA) * GRILLA * 100) / 100; }
  function copia(o){ return JSON.parse(JSON.stringify(o)); }
  function dist(p, q){ return Math.hypot(q[0] - p[0], q[1] - p[1]); }
  function S(p){ return r4(p[0]) + ',' + r4(-p[1]); }                  // punto del modelo → SVG
  function num(v){ return Number(String(v).replace(',', '.')); }
  function m2(v){ return v.toLocaleString('es-PY', {minimumFractionDigits:2, maximumFractionDigits:2}); }
  function geo(w){
    var dx = w.a[0] - w.de[0], dy = w.a[1] - w.de[1], L = Math.hypot(dx, dy) || 1e-9;
    return {L:L, ux:dx/L, uy:dy/L, nx:-dy/L, ny:dx/L};
  }
  function en(w, g, t, n){ return [w.de[0] + g.ux*t + g.nx*n, w.de[1] + g.uy*t + g.ny*n]; }
  function area(p){ var s = 0; for (var i = 0; i < p.length; i++){ var q = p[(i+1) % p.length]; s += p[i][0]*q[1] - q[0]*p[i][1]; } return s / 2; }
  function centro(p){
    var a = area(p), cx = 0, cy = 0;
    if (Math.abs(a) < 1e-9){ p.forEach(function(q){ cx += q[0]; cy += q[1]; }); return [cx / p.length, cy / p.length]; }
    for (var i = 0; i < p.length; i++){ var q = p[(i+1) % p.length], f = p[i][0]*q[1] - q[0]*p[i][1]; cx += (p[i][0] + q[0])*f; cy += (p[i][1] + q[1])*f; }
    return [cx / (6*a), cy / (6*a)];
  }
  function adentro(pt, p){
    var c = false;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++)
      if ((p[i][1] > pt[1]) !== (p[j][1] > pt[1]) && pt[0] < (p[j][0] - p[i][0]) * (pt[1] - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    return c;
  }
  function sinCierre(p){ p = p || []; var n = p.length; return n > 1 && p[0][0] === p[n-1][0] && p[0][1] === p[n-1][1] ? p.slice(0, n-1) : p; }
  function nuevoId(pref, lista){ var n = lista.length + 1; while (lista.some(function(x){ return x.id === pref + n; })) n++; return pref + n; }
  function familia(t){ return /^ventana/.test(t) ? 'ventana' : 'puerta'; }

  // Rastreo como en el CAD: si x (o y) del punto queda a menos de «tol» de la x (o y) de un extremo de referencia,
  // se engancha a esa coordenada y se devuelve la guía punteada desde el extremo hasta el punto.
  // Con base y sin «libre» el muro es ortogonal: solo se rastrea el eje que se mueve. La base no cuenta como referencia.
  function rastreo(q, base, refs, tol, libre){
    var p = [q[0], q[1]], guias = [];
    var ejes = base && !libre ? (q[1] === base[1] ? [0] : q[0] === base[0] ? [1] : []) : [0, 1];
    ejes.forEach(function(k){
      var mejor = null, md = tol;
      (refs || []).forEach(function(r){
        if (base && r[0] === base[0] && r[1] === base[1]) return;
        var d = Math.abs(r[k] - q[k]);
        if (d < md || (mejor && d === md && dist(r, q) < dist(mejor, q))){ md = d; mejor = r; }
      });
      if (mejor){ p[k] = mejor[k]; guias.push(mejor); }
    });
    return {p:p, guias:guias.map(function(r){ return {de:[r[0], r[1]], a:p}; })};
  }

  function crear(svg, op){
    op = op || {};
    var M = {muros:[], aberturas:[], ambientes:[]};
    var F = null, lineas = null, dLineas = '';           // fondo de imagen y líneas del DXF
    var V = {cx:0, cy:0, s:40};                          // centro de la vista (m) y píxeles por metro
    var H = 'seleccionar', bloqueado = false, ext = false;
    var auto = true, pila = [], sel = null, temp = null, cursor = null, arr = null, caja = null, espacio = false;
    var cont = svg.parentNode;
    var capas = {};
    ['fondo','amb','mur','abe','txt','sel','temp'].forEach(function(k){
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.setAttribute('class', 'c-' + k); svg.appendChild(g); capas[k] = g;
    });

    // ---- vista ----
    function rect(){ return svg.getBoundingClientRect(); }
    function vista(){
      var r = rect(), w = Math.max(1, r.width) / V.s, h = Math.max(1, r.height) / V.s;
      svg.setAttribute('viewBox', [r4(V.cx - w/2), r4(-V.cy - h/2), r4(w), r4(h)].join(' '));
    }
    function aModelo(ev){
      var r = rect();
      return [V.cx + (ev.clientX - r.left - r.width/2) / V.s, V.cy - (ev.clientY - r.top - r.height/2) / V.s];
    }
    function encuadrar(){
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      function sumar(p){ x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      M.muros.forEach(function(w){ sumar(w.de); sumar(w.a); });
      M.ambientes.forEach(function(a){ (a.poligono || []).forEach(sumar); });
      if (F){ sumar([0, 0]); sumar([F.w*F.mpp, -F.h*F.mpp]); }
      if (lineas) lineas.forEach(function(s){ sumar(s.a); sumar(s.b); });
      var r = rect();
      if (x0 === Infinity){ V = {cx:0, cy:0, s:40}; }
      else {
        var bw = Math.max(x1 - x0, 1), bh = Math.max(y1 - y0, 1);
        V = {cx:(x0 + x1)/2, cy:(y0 + y1)/2, s:Math.max(2, Math.min((r.width || 600) / (bw*1.12), (r.height || 400) / (bh*1.12)))};
      }
      auto = true; vista(); dibujar();
    }
    function zoom(f, ev){
      var r = rect(), p = ev ? aModelo(ev) : [V.cx, V.cy];
      var ox = ev ? ev.clientX - r.left - r.width/2 : 0, oy = ev ? ev.clientY - r.top - r.height/2 : 0;
      auto = false; V.s = Math.min(3000, Math.max(1, V.s * f));
      V.cx = p[0] - ox / V.s; V.cy = p[1] + oy / V.s;
      vista(); dibujar();
    }

    // ---- dibujo ----
    function porId(id){ for (var i = 0; i < M.muros.length; i++) if (M.muros[i].id === id) return M.muros[i]; return null; }
    function tocaExtremo(w, p){
      return M.muros.some(function(o){ return o !== w && (dist(o.de, p) < 0.02 || dist(o.a, p) < 0.02); });
    }
    function poli(pts, cls, extra){ return '<polygon class="' + cls + '" points="' + pts.map(S).join(' ') + '"' + (extra || '') + '/>'; }
    function linea(p, q, cls){ return '<path class="' + cls + '" d="M' + S(p) + 'L' + S(q) + '"/>'; }
    function dibujar(){
      var px = 1 / V.s, h = [];
      // fondo
      var f = '';
      if (F) f += '<image href="' + esc(F.url) + '" x="0" y="0" width="' + r4(F.w*F.mpp) + '" height="' + r4(F.h*F.mpp) + '" preserveAspectRatio="none" opacity=".8"/>';
      if (dLineas) f += '<path class="fondo-lineas" d="' + dLineas + '"/>';
      if (capas.fondo._f !== f){ capas.fondo.innerHTML = f; capas.fondo._f = f; }
      svg.classList.toggle('con-fondo', !!F);
      // ambientes y rótulos
      var txt = [];
      M.ambientes.forEach(function(a){
        var p = sinCierre(a.poligono);
        if (p.length < 3) return;
        h.push(poli(p, 'amb' + (a.tipo === 'exterior' ? ' ext' : ''), ' data-id="' + esc(a.id) + '"'));
        // rótulo: 11 px, más chico si no entra en el ambiente; si queda ilegible no se pone
        var xs = p.map(function(q){ return q[0]; }), anchoPx = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) * V.s;
        var largoT = Math.max(String(a.nombre || '').length, 9), fpx = Math.min(11, anchoPx * 0.9 / (largoT * 0.62));
        if (fpx < 6.5) return;
        var c = centro(p), fs = fpx * px;
        txt.push('<text class="amb-t" x="' + r4(c[0]) + '" y="' + r4(-c[1]) + '" font-size="' + r4(fs) + '">' + esc(String(a.nombre || '').toUpperCase()) +
          '<tspan class="a" x="' + r4(c[0]) + '" dy="1.25em">' + m2(Math.abs(area(p))) + ' m²</tspan></text>');
      });
      capas.amb.innerHTML = h.join(''); h = [];
      // muros, partidos en los vanos; las puntas que tocan otro muro se prolongan media esp. (esquinas llenas)
      var ab = [];
      M.muros.forEach(function(w){
        var g = geo(w), e = w.esp / 2, cls = 'mur' + (w.propuesto ? ' prop' : '');
        var vanos = M.aberturas.filter(function(o){ return o.muro === w.id; }).map(function(o){
          var d0 = Math.max(0, Math.min(g.L, o.desde)), d1 = Math.max(d0, Math.min(g.L, o.desde + o.ancho));
          ab.push({o:o, w:w, g:g, d0:d0, d1:d1});
          return [d0, d1];
        }).sort(function(x, y){ return x[0] - y[0]; });
        var t = tocaExtremo(w, w.de) ? -e : 0, fin = g.L + (tocaExtremo(w, w.a) ? e : 0);
        vanos.forEach(function(v){
          if (v[0] > t + 1e-6) h.push(poli([en(w,g,t,-e), en(w,g,v[0],-e), en(w,g,v[0],e), en(w,g,t,e)], cls));
          t = Math.max(t, v[1]);
        });
        if (fin > t + 1e-6) h.push(poli([en(w,g,t,-e), en(w,g,fin,-e), en(w,g,fin,e), en(w,g,t,e)], cls));
      });
      capas.mur.innerHTML = h.join(''); h = [];
      // aberturas: vano, jambas y símbolo (hoja con giro, corrediza o ventana)
      ab.forEach(function(x){
        var w = x.w, g = x.g, e = w.esp / 2, o = x.o, d0 = x.d0, d1 = x.d1, an = d1 - d0, cls = 'abe' + (o.propuesto ? ' prop' : '');
        if (an <= 1e-6) return;
        h.push(poli([en(w,g,d0,-e), en(w,g,d1,-e), en(w,g,d1,e), en(w,g,d0,e)], 'abe vano' + (o.propuesto ? ' prop' : '')));
        h.push(linea(en(w,g,d0,-e), en(w,g,d0,e), cls), linea(en(w,g,d1,-e), en(w,g,d1,e), cls));
        var t = String(o.tipo || '');
        if (/^ventana/.test(t)){
          h.push(linea(en(w,g,d0,-e), en(w,g,d1,-e), cls), linea(en(w,g,d0,0), en(w,g,d1,0), cls), linea(en(w,g,d0,e), en(w,g,d1,e), cls));
        } else if (/corrediza/.test(t)){
          h.push(linea(en(w,g,d0,-e/3), en(w,g,d0 + an*0.55,-e/3), cls), linea(en(w,g,d1 - an*0.55,e/3), en(w,g,d1,e/3), cls));
        } else if (/^puerta/.test(t)){
          var bis = en(w,g,d0,e), hoja = en(w,g,d0,e + an), jam = en(w,g,d1,e);
          var a1 = [hoja[0] - bis[0], -(hoja[1] - bis[1])], a2 = [jam[0] - bis[0], -(jam[1] - bis[1])];
          var giro = a1[0]*a2[1] - a1[1]*a2[0] > 0 ? 1 : 0;
          h.push(linea(bis, hoja, cls), '<path class="' + cls + '" d="M' + S(hoja) + 'A' + r4(an) + ',' + r4(an) + ' 0 0 ' + giro + ' ' + S(jam) + '"/>');
        }
      });
      capas.abe.innerHTML = h.join('');
      capas.txt.innerHTML = txt.join('');
      dibujarSel(); dibujarTemp();
    }
    function dibujarSel(){
      var h = [], px = 1 / V.s;
      if (sel && sel.k === 'muro'){
        var w = porId(sel.id);
        if (w){
          var g = geo(w), e = w.esp / 2;
          h.push(poli([en(w,g,0,-e), en(w,g,g.L,-e), en(w,g,g.L,e), en(w,g,0,e)], 'sel'));
          if (!bloqueado) [w.de, w.a].forEach(function(p){ h.push('<circle class="asa" cx="' + r4(p[0]) + '" cy="' + r4(-p[1]) + '" r="' + r4(5*px) + '"/>'); });
        }
      } else if (sel && sel.k === 'abertura'){
        var o = M.aberturas.filter(function(x){ return x.id === sel.id; })[0], m = o && porId(o.muro);
        if (m){
          var g2 = geo(m), e2 = m.esp / 2 + 2*px, d0 = Math.max(0, o.desde), d1 = Math.min(g2.L, o.desde + o.ancho);
          h.push(poli([en(m,g2,d0,-e2), en(m,g2,d1,-e2), en(m,g2,d1,e2), en(m,g2,d0,e2)], 'sel'));
        }
      } else if (sel && sel.k === 'ambiente'){
        var a = M.ambientes.filter(function(x){ return x.id === sel.id; })[0];
        if (a) h.push(poli(sinCierre(a.poligono), 'sel'));
      }
      capas.sel.innerHTML = h.join('');
    }
    function cota(p, q){
      var px = 1 / V.s, d = dist(p, q);
      if (d < 1e-6) return '';
      return '<text class="cota-t" x="' + r4((p[0] + q[0])/2 + 6*px) + '" y="' + r4(-(p[1] + q[1])/2 - 6*px) + '" font-size="' + r4(12*px) + '">' +
        d.toLocaleString('es-PY', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' m</text>';
    }
    function dibujarTemp(){
      var h = [], px = 1 / V.s;
      if (!bloqueado && cursor && (H === 'muro' || H === 'ambiente')){
        var s = iman(cursor.p, H === 'muro' && temp ? temp.p0 : null, cursor.libre);
        if (H === 'muro' && temp){ h.push(linea(temp.p0, s.p, 'temp'), cota(temp.p0, s.p)); }
        if (H === 'ambiente' && temp && temp.pts.length){
          var pts = temp.pts.concat([s.p]);
          h.push(poli(pts, 'temp-amb'));
          if (pts.length >= 3) h.push('<text class="cota-t" x="' + r4(pts[0][0] + 8*px) + '" y="' + r4(-pts[0][1] - 8*px) + '" font-size="' + r4(12*px) + '">' + m2(Math.abs(area(pts))) + ' m²</text>');
        }
        s.guias.forEach(function(g){
          h.push(linea(g.de, g.a, 'guia'), '<path class="guia-x" d="M' + r4(g.de[0] - 4*px) + ',' + r4(-g.de[1] - 4*px) + 'l' + r4(8*px) + ',' + r4(8*px) +
            'm0,' + r4(-8*px) + 'l' + r4(-8*px) + ',' + r4(8*px) + '"/>');
        });
        if (s.iman) h.push('<circle class="iman" cx="' + r4(s.p[0]) + '" cy="' + r4(-s.p[1]) + '" r="' + r4(7*px) + '"/>');
        h.push('<circle class="temp-p" cx="' + r4(s.p[0]) + '" cy="' + r4(-s.p[1]) + '" r="' + r4(2.5*px) + '"/>');
      }
      if (!bloqueado && H === 'escala' && temp){
        var q = cursor ? cursor.p : temp.p0;
        h.push(linea(temp.p0, q, 'temp'), '<circle class="temp-p" cx="' + r4(temp.p0[0]) + '" cy="' + r4(-temp.p0[1]) + '" r="' + r4(3*px) + '"/>');
      }
      capas.temp.innerHTML = h.join('');
    }

    // ---- imán: extremos de muros (10 px); si no, grilla de 0,05, ortogonal respecto de la base
    //      y rastreo de alineación con los extremos (guía punteada, como en el CAD) ----
    function iman(p, base, libre){
      var tol = IMAN_PX / V.s, mejor = null, md = tol, refs = [];
      M.muros.forEach(function(w){ refs.push(w.de, w.a); });
      if (temp && temp.pts) refs = refs.concat(temp.pts);
      if (temp && temp.inicio) refs.push(temp.inicio);
      refs.forEach(function(q){ var d = dist(p, q); if (d < md){ md = d; mejor = q; } });
      if (mejor) return {p:[mejor[0], mejor[1]], iman:true, guias:[]};
      var q = [grilla(p[0]), grilla(p[1])];
      if (base && !libre){ if (Math.abs(q[0] - base[0]) >= Math.abs(q[1] - base[1])) q[1] = base[1]; else q[0] = base[0]; }
      var r = rastreo(q, base, refs, RASTREO_PX / V.s, libre);
      return {p:r.p, iman:false, guias:r.guias};
    }
    // ---- qué hay bajo el puntero: abertura > muro > ambiente (el más chico) ----
    function proyectar(w, p){ var g = geo(w), dx = p[0] - w.de[0], dy = p[1] - w.de[1]; return {g:g, t:dx*g.ux + dy*g.uy, n:dx*g.nx + dy*g.ny}; }
    function muroCerca(p){
      var tol = TOL_PX / V.s, mejor = null, md = Infinity;
      M.muros.forEach(function(w){
        var j = proyectar(w, p), d = Math.abs(j.n);
        if (d <= w.esp/2 + tol && j.t >= -tol && j.t <= j.g.L + tol && d < md){ md = d; mejor = {w:w, t:Math.max(0, Math.min(j.g.L, j.t)), L:j.g.L}; }
      });
      return mejor;
    }
    function tocar(p){
      var tol = TOL_PX / V.s;
      for (var i = M.aberturas.length - 1; i >= 0; i--){
        var o = M.aberturas[i], w = porId(o.muro);
        if (!w) continue;
        var j = proyectar(w, p);
        if (Math.abs(j.n) <= w.esp/2 + tol && j.t >= o.desde - tol/2 && j.t <= o.desde + o.ancho + tol/2) return {k:'abertura', id:o.id};
      }
      var m = muroCerca(p);
      if (m) return {k:'muro', id:m.w.id};
      var amb = null, ma = Infinity;
      M.ambientes.forEach(function(a){
        var q = sinCierre(a.poligono), s = Math.abs(area(q));
        if (q.length >= 3 && adentro(p, q) && s < ma){ ma = s; amb = a; }
      });
      return amb ? {k:'ambiente', id:amb.id} : null;
    }

    // ---- cambios, deshacer (50 pasos) ----
    // Cada paso guarda el modelo serializado; las líneas del DXF y la imagen de fondo van por referencia
    // (nunca se modifican, se reemplazan).
    function foto(){ return {m:JSON.stringify({M:M, mpp:F ? F.mpp : null}), lineas:lineas, d:dLineas, F:F && {url:F.url, w:F.w, h:F.h}}; }
    function apilar(f){ pila.push(f || foto()); if (pila.length > PILA) pila.shift(); }
    function cambio(){ dibujar(); if (op.onCambio) op.onCambio(copia(M)); }
    function pista(t){ if (op.onPista) op.onPista(t); }
    function deshacer(){
      if (bloqueado || !pila.length) return;
      var paso = pila.pop(), f = JSON.parse(paso.m), vacio = !M.muros.length && !M.ambientes.length && !F && !lineas;
      M = f.M; F = paso.F ? {url:paso.F.url, w:paso.F.w, h:paso.F.h, mpp:f.mpp} : null;
      lineas = paso.lineas; dLineas = paso.d;
      sel = null; temp = null; cerrarCaja();
      if (vacio) encuadrar();   // deshacer «Plano nuevo»: se vuelve a ver todo el plano
      cambio();
    }
    function borrar(s){
      if (!s || bloqueado) return;
      apilar();
      if (s.k === 'muro'){
        M.muros = M.muros.filter(function(w){ return w.id !== s.id; });
        M.aberturas = M.aberturas.filter(function(o){ return o.muro !== s.id; });
      } else if (s.k === 'abertura') M.aberturas = M.aberturas.filter(function(o){ return o.id !== s.id; });
      else if (s.k === 'ambiente') M.ambientes = M.ambientes.filter(function(a){ return a.id !== s.id; });
      sel = null; cerrarCaja(); cambio();
    }
    function escalar(k){
      if (!(k > 0) || !isFinite(k)) return;
      function e(p){ return [r4(p[0]*k), r4(p[1]*k)]; }
      M.muros.forEach(function(w){ w.de = e(w.de); w.a = e(w.a); });
      M.aberturas.forEach(function(o){ o.desde = r4(o.desde*k); o.ancho = r4(o.ancho*k); });
      M.ambientes.forEach(function(a){ a.poligono = (a.poligono || []).map(e); });
      if (F) F.mpp *= k;
      if (lineas) ponerLineas(lineas.map(function(s){ return {a:e(s.a), b:e(s.b)}; }));
      V.cx *= k; V.cy *= k; V.s /= k; vista();
    }
    function ponerLineas(segs){
      lineas = segs && segs.length ? segs.map(function(s){ return {a:[s.a[0], s.a[1]], b:[s.b[0], s.b[1]]}; }) : null;
      dLineas = lineas ? lineas.map(function(s){ return 'M' + S(s.a) + 'L' + S(s.b); }).join('') : '';
    }

    // ---- recuadro chico de edición ----
    function cerrarCaja(){ if (caja){ caja.remove(); caja = null; } }
    function abrirCaja(ev, titulo, campos, alListo, alBorrar){
      cerrarCaja();
      var f = document.createElement('form');
      f.className = 'recuadro';
      f.innerHTML = '<h3>' + esc(titulo) + '</h3>' + campos + '<div class="fila">' +
        (alBorrar ? '<button type="button" class="borrar">Borrar</button>' : '') +
        '<button type="button" class="cancelar">Cancelar</button><button type="submit">Listo</button></div>';
      cont.appendChild(f); caja = f;
      var r = cont.getBoundingClientRect(), x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
      f.style.left = Math.max(6, Math.min(x, r.width - f.offsetWidth - 6)) + 'px';
      f.style.top = Math.max(6, Math.min(y, r.height - f.offsetHeight - 6)) + 'px';
      f.addEventListener('submit', function(e){ e.preventDefault(); if (alListo(f.elements) !== false) cerrarCaja(); });
      f.querySelector('.cancelar').addEventListener('click', cerrarCaja);
      if (alBorrar) f.querySelector('.borrar').addEventListener('click', alBorrar);
      f.addEventListener('keydown', function(e){ if (e.key === 'Escape'){ e.stopPropagation(); cerrarCaja(); } });
      var primero = f.querySelector('input,select'); if (primero){ primero.focus(); if (primero.select) primero.select(); }
      return f;
    }
    function opciones(lista, v){ return lista.map(function(o){ return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + o[1] + '</option>'; }).join(''); }
    function campoNum(nombre, etiqueta, v){
      return '<label>' + etiqueta + '<input name="' + nombre + '" type="number" step="0.01" min="0.05" value="' + r4(v).toFixed(2) + '" required></label>';
    }
    function cajaAbertura(o, ev){
      var lista = TIPOS_ABE.some(function(t){ return t[0] === o.tipo; }) ? TIPOS_ABE : TIPOS_ABE.concat([[o.tipo, o.tipo]]);
      var f = abrirCaja(ev, o.propuesto ? 'Abertura propuesta' : 'Abertura',
        '<label>Tipo<select name="tipo">' + opciones(lista, o.tipo) + '</select></label>' +
        campoNum('ancho', 'Ancho (m)', o.ancho) + campoNum('alto', 'Alto (m)', o.alto),
        function(el){
          var an = num(el.ancho.value), al = num(el.alto.value), w = porId(o.muro);
          if (!(an > 0) || !(al > 0) || !w) return false;
          apilar();
          var L = geo(w).L; an = Math.min(an, L);
          o.tipo = el.tipo.value; o.ancho = r4(an); o.alto = r4(al); o.desde = r4(Math.max(0, Math.min(o.desde, L - an)));
          delete o.propuesto; cambio();
        }, function(){ borrar({k:'abertura', id:o.id}); });
      var antes = familia(o.tipo);
      f.elements.tipo.addEventListener('change', function(){   // puerta ↔ ventana: si el alto es el de la otra familia, se cambia
        var ahora = familia(f.elements.tipo.value);
        if (ahora !== antes && Math.abs(num(f.elements.alto.value) - NUEVA[antes].alto) < 1e-6) f.elements.alto.value = NUEVA[ahora].alto.toFixed(2);
        antes = ahora;
      });
    }
    function cajaMuro(w, ev){
      abrirCaja(ev, w.propuesto ? 'Muro propuesto' : 'Muro',
        '<label class="chk"><input name="ext" type="checkbox"' + (w.tipo === 'exterior' ? ' checked' : '') + '> Exterior</label>' +
        campoNum('esp', 'Espesor (m)', w.esp) + '<p class="nota-l">Largo: ' + m2(geo(w).L) + ' m</p>',
        function(el){
          var e = num(el.esp.value);
          if (!(e > 0)) return false;
          apilar(); w.tipo = el.ext.checked ? 'exterior' : 'interior'; w.esp = r4(e); delete w.propuesto; cambio();
        }, function(){ borrar({k:'muro', id:w.id}); });
    }
    function cajaAmbiente(a, ev, alListo){
      var nuevo = !a;
      a = a || {tipo:'dormitorio', nombre:''};
      abrirCaja(ev, nuevo ? 'Ambiente nuevo' : 'Ambiente',
        '<label>Tipo<select name="tipo">' + opciones(TIPOS_AMB, a.tipo) + '</select></label>' +
        '<label>Nombre<input name="nombre" type="text" maxlength="40" value="' + esc(a.nombre) + '" placeholder="Ej.: Dormitorio 1"></label>',
        function(el){
          var tipo = el.tipo.value, nombre = el.nombre.value.trim();
          if (!nombre) nombre = TIPOS_AMB.filter(function(t){ return t[0] === tipo; })[0][1];
          if (alListo) return alListo(tipo, nombre);
          apilar(); a.tipo = tipo; a.nombre = nombre; delete a.cubierto; cambio();
        }, nuevo ? null : function(){ borrar({k:'ambiente', id:a.id}); });
    }

    // ---- herramientas ----
    function herramienta(h){
      if (bloqueado) h = 'seleccionar';
      if (!PISTAS[h]) return;
      H = h; temp = null; cerrarCaja();
      if (h !== 'seleccionar') sel = null;
      svg.setAttribute('data-h', h);
      pista(bloqueado ? PISTAS.bloqueado : PISTAS[h]);
      dibujar();
      if (op.onHerramienta) op.onHerramienta(h);
    }
    function clic(p, ev){
      if (bloqueado) return;
      var s;
      if (H === 'seleccionar'){
        sel = tocar(p); dibujarSel();
        if (!sel){ cerrarCaja(); return; }
        if (sel.k === 'muro') cajaMuro(porId(sel.id), ev);
        else if (sel.k === 'abertura') cajaAbertura(M.aberturas.filter(function(o){ return o.id === sel.id; })[0], ev);
        else cajaAmbiente(M.ambientes.filter(function(a){ return a.id === sel.id; })[0], ev);
      } else if (H === 'muro'){
        s = iman(p, temp ? temp.p0 : null, ev.shiftKey).p;
        if (!temp){ temp = {p0:s, inicio:s}; dibujarTemp(); return; }
        if (dist(s, temp.p0) < GRILLA){ return; }
        apilar();
        var exterior = ext;
        M.muros.push({id:nuevoId('M', M.muros), de:temp.p0, a:s, esp:exterior ? 0.20 : 0.15, tipo:exterior ? 'exterior' : 'interior'});
        temp = dist(s, temp.inicio) < 1e-6 ? null : {p0:s, inicio:temp.inicio};   // cerrar el recinto termina la cadena
        cambio();
      } else if (H === 'puerta' || H === 'ventana'){
        var m = muroCerca(p);
        if (!m){ pista('Hacé clic sobre un muro'); return; }
        var d = NUEVA[H], an = Math.min(d.ancho, m.L);
        apilar();
        var o = {id:nuevoId('A', M.aberturas), muro:m.w.id, desde:r4(Math.max(0, Math.min(m.t - an/2, m.L - an))), ancho:r4(an), alto:d.alto, tipo:d.tipo};
        M.aberturas.push(o);
        sel = {k:'abertura', id:o.id}; cambio();
        cajaAbertura(o, ev);
      } else if (H === 'ambiente'){
        s = iman(p, null, true).p;
        if (!temp) temp = {pts:[]};
        var n = temp.pts.length;
        if (n && dist(temp.pts[n-1], s) < 1e-6) return;                          // segundo clic del doble clic
        if (n >= 3 && dist(temp.pts[0], s) < 1e-6){ cerrarAmbiente(ev); return; }   // clic en la primera esquina cierra
        temp.pts.push(s); dibujarTemp();
      } else if (H === 'escala'){
        if (!temp){ temp = {p0:p}; dibujarTemp(); return; }
        var dm = dist(temp.p0, p);
        if (dm < 1e-6) return;
        temp = null; dibujarTemp();
        abrirCaja(ev, 'Escala', '<label>Distancia real entre los dos puntos (m)<input name="d" type="number" step="0.01" min="0.01" required></label>', function(el){
          var real = num(el.d.value);
          if (!(real > 0)) return false;
          apilar(); escalar(real / dm); cambio();
          setTimeout(function(){ herramienta('muro'); pista('Escala lista. Dibujá los muros: ' + PISTAS.muro); }, 0);
        });
      }
    }
    function cerrarAmbiente(ev){
      if (!temp || !temp.pts || temp.pts.length < 3) return;
      var pts = temp.pts.slice();
      temp = null; dibujarTemp();
      cajaAmbiente(null, ev, function(tipo, nombre){
        apilar();
        var a = {id:nuevoId('R', M.ambientes), nombre:nombre, tipo:tipo, poligono:pts};
        M.ambientes.push(a); cambio();
      });
    }

    // ---- eventos ----
    svg.addEventListener('pointerdown', function(ev){
      if (caja && !caja.contains(ev.target)) cerrarCaja();
      var p = aModelo(ev), pan = ev.button === 1 || ev.button === 2 || espacio || ev.button === 0 && (H === 'seleccionar' || bloqueado);
      arr = {x:ev.clientX, y:ev.clientY, cx:V.cx, cy:V.cy, movio:false, boton:ev.button, pan:pan};
      if (ev.button === 0 && !bloqueado && H === 'seleccionar' && sel && sel.k === 'muro'){
        var w = porId(sel.id), tol = TOL_PX / V.s;
        if (w) ['de','a'].forEach(function(k){ if (!arr.asa && dist(w[k], p) <= tol){ arr.asa = k; arr.w = w; arr.antes = foto(); arr.pan = false; } });
      }
      try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    svg.addEventListener('pointermove', function(ev){
      var p = aModelo(ev);
      cursor = {p:p, libre:ev.shiftKey};
      if (!arr){ dibujarTemp(); return; }
      var dx = ev.clientX - arr.x, dy = ev.clientY - arr.y;
      if (!arr.movio && Math.hypot(dx, dy) > 4) arr.movio = true;
      if (!arr.movio) return;
      if (arr.asa){
        var otro = arr.asa === 'de' ? arr.w.a : arr.w.de;
        arr.w[arr.asa] = iman(p, otro, ev.shiftKey).p; delete arr.w.propuesto; dibujar();
      } else if (arr.pan){
        svg.classList.add('paneo');
        auto = false; V.cx = arr.cx - dx / V.s; V.cy = arr.cy + dy / V.s; vista();
      }
    });
    svg.addEventListener('pointerup', function(ev){
      var a = arr; arr = null; svg.classList.remove('paneo');
      if (!a) return;
      if (a.asa && a.movio){ apilar(a.antes); cambio(); return; }
      if (!a.movio && a.boton === 0) clic(aModelo(ev), ev);
      if (!a.movio && a.boton === 2 && temp){ temp = null; dibujarTemp(); }   // clic derecho: termina lo que se está dibujando
    });
    svg.addEventListener('pointerleave', function(){ cursor = null; dibujarTemp(); });
    svg.addEventListener('dblclick', function(ev){ if (H === 'ambiente' && !bloqueado){ ev.preventDefault(); cerrarAmbiente(ev); } });
    svg.addEventListener('contextmenu', function(ev){ ev.preventDefault(); });
    svg.addEventListener('wheel', function(ev){ ev.preventDefault(); zoom(Math.exp(-ev.deltaY * 0.0015), ev); }, {passive:false});
    function enCampo(e){ return /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable; }
    document.addEventListener('keydown', function(e){
      if (enCampo(e)) return;
      if (e.key === ' ') { espacio = true; if (document.activeElement === document.body) e.preventDefault(); }
      else if (e.key === 'Escape'){ if (caja) cerrarCaja(); else { temp = null; sel = null; dibujar(); } }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel){ e.preventDefault(); borrar(sel); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')){ e.preventDefault(); deshacer(); }
    });
    document.addEventListener('keyup', function(e){ if (e.key === ' ') espacio = false; });
    if (root.ResizeObserver) new ResizeObserver(function(){ if (auto) encuadrar(); else vista(); }).observe(svg);

    // ---- API ----
    return {
      cargar:function(modelo){
        modelo = modelo || {};
        M = {muros:copia(modelo.muros || []), aberturas:copia(modelo.aberturas || []), ambientes:copia(modelo.ambientes || [])};
        F = null; ponerLineas(null); pila = []; sel = null; temp = null; cerrarCaja();
        encuadrar(); if (op.onCambio) op.onCambio(copia(M));
      },
      modelo:function(){ return copia(M); },
      fondo:function(url, anchoPx, altoPx){
        F = url ? {url:url, w:anchoPx, h:altoPx, mpp:20 / Math.max(anchoPx, altoPx, 1)} : null;   // 20 m de lado mayor hasta dar la escala
        encuadrar();
      },
      fondoLineas:function(segmentos){ ponerLineas(segmentos); encuadrar(); },
      escala:function(metrosPorPx){ if (F && metrosPorPx > 0){ apilar(); escalar(metrosPorPx / F.mpp); cambio(); } },
      herramienta:herramienta,
      deshacer:deshacer,
      nuevo:function(){   // plano en blanco: sin muros, aberturas, ambientes ni fondo; se puede deshacer
        if (bloqueado) return;
        apilar();
        M = {muros:[], aberturas:[], ambientes:[]}; F = null; ponerLineas(null);
        sel = null; temp = null; cerrarCaja(); encuadrar(); cambio();
      },
      confirmarPropuestos:function(){
        if (!M.muros.concat(M.aberturas).some(function(x){ return x.propuesto; })) return;
        apilar();
        M.muros.forEach(function(w){ delete w.propuesto; }); M.aberturas.forEach(function(o){ delete o.propuesto; });
        cambio();
      },
      bloquear:function(si){ bloqueado = !!si; sel = null; temp = null; cerrarCaja(); herramienta('seleccionar'); },
      exterior:function(si){ ext = !!si; },
      encuadrar:encuadrar,
      zoom:function(f){ zoom(f); }
    };
  }

  var api = {crear:crear, rastreo:rastreo};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FugaEditor = api;
})(typeof window === 'undefined' ? globalThis : window);
