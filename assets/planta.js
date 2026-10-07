// FUGA Tech · demo de vivienda.
// Dibuja la planta de Casa Patio desde el mismo archivo de entrada que usa el motor: muros, aberturas, ambientes, mobiliario y cotas.
// Los símbolos de puertas y muebles son una versión simple hecha para el navegador.
(function () {
  'use strict';
  var PI = Math.PI, TAU = PI * 2, ACC = '#004ED8';
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function out(t) { return 1 - Math.pow(1 - t, 3); }
  function dec(n) { return n.toFixed(2).replace('.', ','); }
  function area(p) { var s = 0; for (var i = 0; i < p.length - 1; i++) s += p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1]; return Math.abs(s) / 2; }

  function fugaPlanta(root, D) {
    var cv = root.querySelector('canvas'), ctx = cv.getContext('2d'), view = root.querySelector('.cad-view');
    var cmdEl = root.querySelector('.cad-cmd'), info = root.querySelector('[data-t="info"]');
    var stat = {}; [].forEach.call(root.querySelectorAll('[data-n]'), function (e) { stat[e.getAttribute('data-n')] = e; });
    var btn = {}; [].forEach.call(root.querySelectorAll('[data-act]'), function (e) { btn[e.getAttribute('data-act')] = e; });
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var cst = getComputedStyle(root);
    function col(n, d) { var v = cst.getPropertyValue(n).trim(); return v || d; }
    var C = { bg: col('--cad-bg', '#F4F2ED'), ln: col('--cad-line', '#0A0A0A'), dm: col('--cad-dim', '#55524C') };
    var W = 0, H = 0, dpr = 1, gen = 0, lines = [], sel = -1, show = { mob: true, cot: true };
    var S = { w: 1, o: 1, r: 1, f: 1, c: 1 };
    var walls = {}; D.muros.forEach(function (m) { walls[m.id] = m; });
    var rooms = D.ambientes.map(function (a) { var xs = a.p.map(function (q) { return q[0]; }), ys = a.p.map(function (q) { return q[1]; }); return { n: a.n, p: a.p, e: a.e, m2: area(a.p), w: Math.max.apply(0, xs) - Math.min.apply(0, xs), h: Math.max.apply(0, ys) - Math.min.apply(0, ys) }; });
    var nP = 0, nV = 0, nH = 0; D.aberturas.forEach(function (a) { if (/^puerta/.test(a.tipo)) nP++; else if (/^ventana/.test(a.tipo)) nV++; else nH++; });
    var chains = D.cotas.filter(function (c) { return c.t; }).length;

    var bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
    function grow(q) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); by0 = Math.min(by0, q[1]); by1 = Math.max(by1, q[1]); }
    D.muros.forEach(function (m) { grow([m.de[0] - m.esp, m.de[1] - m.esp]); grow([m.a[0] + m.esp, m.a[1] + m.esp]); });
    D.cotas.forEach(function (c) { grow(c.u); });
    bx0 -= .7; bx1 += .7; by0 -= .7; by1 += .7;

    var ppm = 1, ox = 0, oy = 0;
    function X(x) { return ox + (x - bx0) * ppm; }
    function Y(y) { return oy - (y - by0) * ppm; }

    function wallFrame(m) { var dx = m.a[0] - m.de[0], dy = m.a[1] - m.de[1], L = Math.hypot(dx, dy); return { ux: dx / L, uy: dy / L, nx: -dy / L, ny: dx / L, L: L }; }
    function quad(pts) { ctx.beginPath(); pts.forEach(function (q, i) { if (i) ctx.lineTo(X(q[0]), Y(q[1])); else ctx.moveTo(X(q[0]), Y(q[1])); }); ctx.closePath(); }
    function seg(a, b) { ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); }
    function band(m, f, s0, s1, half) {       // rectángulo sobre el eje del muro, de s0 a s1, con medio espesor "half"
      var o = m.de;
      return [[o[0] + f.ux * s0 + f.nx * half, o[1] + f.uy * s0 + f.ny * half], [o[0] + f.ux * s1 + f.nx * half, o[1] + f.uy * s1 + f.ny * half],
        [o[0] + f.ux * s1 - f.nx * half, o[1] + f.uy * s1 - f.ny * half], [o[0] + f.ux * s0 - f.nx * half, o[1] + f.uy * s0 - f.ny * half]];
    }

    function furniture(m) {
      var w = m.w * ppm, h = m.h * ppm, i, n;
      ctx.save(); ctx.translate(X(m.en[0]), Y(m.en[1])); ctx.rotate(-m.rot * PI / 180); ctx.scale(1, -1);     // (0,0) esquina, x derecha, y arriba
      ctx.beginPath();
      if (m.b === 'mesa') {
        var c = Math.min(.42 * ppm, Math.min(w, h) * .55), along = w >= h;
        n = Math.max(1, Math.floor((along ? m.w : m.h) / .62));
        for (i = 0; i < n; i++) {
          var p = ((i + .5) / n) * (along ? w : h) - c / 2;
          if (along) { ctx.rect(p, -c * .72, c, c * .6); ctx.rect(p, h + c * .12, c, c * .6); } else { ctx.rect(-c * .72, p, c * .6, c); ctx.rect(w + c * .12, p, c * .6, c); }
        }
        ctx.rect(0, 0, w, h);
      } else if (m.b === 'cama_2p' || m.b === 'cama_1p') {
        ctx.rect(0, 0, w, h); n = m.b === 'cama_2p' ? 2 : 1;
        var pw = w / n * .7, phh = Math.min(h * .16, .34 * ppm);
        for (i = 0; i < n; i++) ctx.rect(w / n * i + (w / n - pw) / 2, h - phh - h * .05, pw, phh);
        ctx.moveTo(0, h * .62); ctx.lineTo(w, h * .62);
      } else if (m.b === 'sillon') { ctx.rect(0, 0, w, h); ctx.moveTo(0, h * .3); ctx.lineTo(w, h * .3); ctx.moveTo(w * .12, h * .3); ctx.lineTo(w * .12, h); ctx.moveTo(w * .88, h * .3); ctx.lineTo(w * .88, h); }
      else if (m.b === 'inodoro') { ctx.rect(w * .08, h * .72, w * .84, h * .28); ctx.ellipse(w / 2, h * .38, w * .4, h * .36, 0, 0, TAU); }
      else if (m.b === 'ducha') { ctx.rect(0, 0, w, h); ctx.moveTo(0, 0); ctx.lineTo(w, h); ctx.moveTo(w, 0); ctx.lineTo(0, h); }
      else if (m.b === 'lavatorio') { ctx.rect(0, 0, w, h); ctx.ellipse(w / 2, h / 2, w * .32, h * .3, 0, 0, TAU); }
      else if (m.b === 'cocina') { ctx.rect(0, 0, w, h); [[.3, .3], [.7, .3], [.3, .7], [.7, .7]].forEach(function (q) { ctx.moveTo(w * q[0] + w * .13, h * q[1]); ctx.arc(w * q[0], h * q[1], w * .13, 0, TAU); }); }
      else if (m.b === 'lavarropas') { ctx.rect(0, 0, w, h); ctx.moveTo(w * .82, h / 2); ctx.arc(w / 2, h / 2, w * .32, 0, TAU); }
      else if (m.b === 'placard' || m.b === 'heladera') { ctx.rect(0, 0, w, h); ctx.moveTo(0, 0); ctx.lineTo(w, h); }
      else ctx.rect(0, 0, w, h);
      if (m.b === 'tv') ctx.fill();
      ctx.stroke(); ctx.restore();
    }

    function opening(a) {
      var m = walls[a.muro], f = wallFrame(m), s0 = a.desde, s1 = a.desde + a.ancho, hf = m.esp / 2, e = 1.2 / ppm;
      ctx.fillStyle = C.bg; quad(band(m, f, s0, s1, hf + e)); ctx.fill();
      ctx.strokeStyle = C.ln; ctx.lineWidth = 1; ctx.beginPath();
      function P(s, d) { return [m.de[0] + f.ux * s + f.nx * d, m.de[1] + f.uy * s + f.ny * d]; }
      seg(P(s0, -hf), P(s0, hf)); seg(P(s1, -hf), P(s1, hf));
      if (a.tipo === 'puerta') {
        var sg = a.lado === 'izquierda' ? 1 : -1, hs = a.abre === 'der' ? s1 : s0, dir = a.abre === 'der' ? -1 : 1, r = a.hoja || a.ancho - .1;
        var hp = P(hs, sg * hf), a0 = Math.atan2(f.ny * sg, f.nx * sg), a1 = Math.atan2(f.uy * dir, f.ux * dir), da = a1 - a0, i;
        while (da > PI) da -= TAU; while (da < -PI) da += TAU;
        ctx.moveTo(X(hp[0]), Y(hp[1])); ctx.lineTo(X(hp[0] + Math.cos(a0) * r), Y(hp[1] + Math.sin(a0) * r));
        ctx.stroke(); ctx.beginPath(); ctx.globalAlpha *= .6;
        for (i = 0; i <= 14; i++) { var t = a0 + da * i / 14, q = [hp[0] + Math.cos(t) * r, hp[1] + Math.sin(t) * r]; if (i) ctx.lineTo(X(q[0]), Y(q[1])); else ctx.moveTo(X(q[0]), Y(q[1])); }
        ctx.stroke(); ctx.globalAlpha /= .6; return;
      }
      if (a.tipo === 'paso') { ctx.stroke(); ctx.beginPath(); ctx.setLineDash([4, 3]); seg(P(s0, hf), P(s1, hf)); seg(P(s0, -hf), P(s1, -hf)); ctx.stroke(); ctx.setLineDash([]); return; }
      if (a.tipo === 'puerta_corrediza') { var md = (s0 + s1) / 2, ov = a.ancho * .06; seg(P(s0, hf * .35), P(md + ov, hf * .35)); seg(P(md - ov, -hf * .35), P(s1, -hf * .35)); ctx.stroke(); return; }
      seg(P(s0, hf), P(s1, hf)); seg(P(s0, -hf), P(s1, -hf)); seg(P(s0, 0), P(s1, 0)); ctx.stroke();
    }

    function cota(c, fz) {
      var hz = Math.abs(c.de[1] - c.a[1]) < 1e-6, tk = .16, p1, p2, e1, e2;
      if (hz) { var yl = c.u[1], sg = yl < c.de[1] ? -1 : 1; p1 = [c.de[0], yl]; p2 = [c.a[0], yl]; e1 = [[c.de[0], c.de[1] + sg * .12], [c.de[0], yl + sg * .14]]; e2 = [[c.a[0], c.a[1] + sg * .12], [c.a[0], yl + sg * .14]]; }
      else { var xl = c.u[0], sx = xl < c.de[0] ? -1 : 1; p1 = [xl, c.de[1]]; p2 = [xl, c.a[1]]; e1 = [[c.de[0] + sx * .12, c.de[1]], [xl + sx * .14, c.de[1]]]; e2 = [[c.a[0] + sx * .12, c.a[1]], [xl + sx * .14, c.a[1]]]; }
      ctx.beginPath(); seg(p1, p2); seg(e1[0], e1[1]); seg(e2[0], e2[1]);
      [p1, p2].forEach(function (q) { seg([q[0] - tk, q[1] - tk], [q[0] + tk, q[1] + tk]); });
      ctx.stroke();
      var txt = dec(c.v), len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * ppm;
      if (len < ctx.measureText(txt).width + 3) return;
      ctx.save(); ctx.translate(X((p1[0] + p2[0]) / 2), Y((p1[1] + p2[1]) / 2)); if (!hz) ctx.rotate(-PI / 2);
      ctx.fillText(txt, 0, -fz * .35); ctx.restore();
    }

    function draw() {
      if (!W || !H) return;
      var i, n, m, f, t;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      ppm = Math.min(W / (bx1 - bx0), H / (by1 - by0));
      ox = (W - (bx1 - bx0) * ppm) / 2; oy = H - (H - (by1 - by0) * ppm) / 2;

      if (sel >= 0 && S.r >= 1) { ctx.fillStyle = ACC; ctx.globalAlpha = .18; quad(rooms[sel].p); ctx.fill(); ctx.globalAlpha = 1; }

      // mobiliario
      if (show.mob) {
        ctx.strokeStyle = C.ln; ctx.fillStyle = C.ln; ctx.lineWidth = 1; ctx.globalAlpha = .62;
        n = Math.floor(S.f * D.mobiliario.length + 1e-6);
        for (i = 0; i < n; i++) furniture(D.mobiliario[i]);
        ctx.globalAlpha = 1;
      }

      // fondo de las etiquetas, para que el nombre no se mezcle con los muebles
      var fz = clamp(ppm * .23, 6.5, 12), fa = clamp(ppm * .2, 6, 10.5), r, lx, ly, tw;
      if (S.r > 0 && show.mob) {
        ctx.font = '700 ' + fz.toFixed(1) + 'px Archivo, Arial, sans-serif'; ctx.fillStyle = C.bg;
        for (i = 0; i < rooms.length; i++) {
          if (clamp(S.r * (rooms.length + 2) - i, 0, 1) <= 0 || i === sel) continue;
          r = rooms[i]; tw = ctx.measureText(r.n).width + 8; ctx.fillRect(X(r.e[0]) - tw / 2, Y(r.e[1]) - fz * .75, tw, fz * 2.6);
        }
      }

      // muros: crecen sobre su eje, uno detrás del otro
      ctx.fillStyle = C.ln; n = D.muros.length;
      for (i = 0; i < n; i++) {
        t = clamp((S.w * (n + 2) - i) / 3, 0, 1); if (t <= 0) continue;
        m = D.muros[i]; f = wallFrame(m);
        quad(band(m, f, -m.esp / 2, out(t) * (f.L + m.esp) - m.esp / 2, m.esp / 2)); ctx.fill();
      }

      // aberturas
      n = Math.floor(S.o * D.aberturas.length + 1e-6);
      for (i = 0; i < n; i++) opening(D.aberturas[i]);

      // ambientes
      if (S.r > 0) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        n = rooms.length;
        for (i = 0; i < n; i++) {
          t = clamp(S.r * (n + 2) - i, 0, 1); if (t <= 0) continue;
          r = rooms[i]; lx = X(r.e[0]); ly = Y(r.e[1]);
          ctx.globalAlpha = t;
          ctx.font = '700 ' + fz.toFixed(1) + 'px Archivo, Arial, sans-serif';
          ctx.fillStyle = C.ln; ctx.fillText(r.n, lx, ly);
          ctx.font = '500 ' + fa.toFixed(1) + 'px Manrope, Arial, sans-serif'; ctx.fillStyle = C.dm; ctx.fillText(dec(r.m2) + ' m²', lx, ly + fz * 1.15);
        }
        ctx.globalAlpha = 1;
      }

      // cotas
      if (show.cot && S.c > 0) {
        var fc = clamp(ppm * .24, 7, 11);
        ctx.strokeStyle = C.dm; ctx.fillStyle = C.dm; ctx.lineWidth = 1; ctx.font = fc.toFixed(1) + 'px Arial, Helvetica, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        n = Math.floor(S.c * D.cotas.length + 1e-6);
        for (i = 0; i < n; i++) cota(D.cotas[i], fc);
      }

      // norte
      var nr = clamp(ppm * .42, 9, 15), nx = W - nr * 1.9, ny = nr * 2.6;
      ctx.strokeStyle = C.ln; ctx.fillStyle = C.ln; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(nx, ny - nr); ctx.lineTo(nx + nr * .42, ny + nr * .7); ctx.lineTo(nx, ny + nr * .35); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(nx, ny - nr); ctx.lineTo(nx - nr * .42, ny + nr * .7); ctx.lineTo(nx, ny + nr * .35); ctx.closePath(); ctx.stroke();
      ctx.font = '700 10px Archivo, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('N', nx, ny - nr - 2);
    }

    function setStat(k, v, d) { if (stat[k]) stat[k].textContent = d ? dec(v) : String(Math.round(v)); }
    function stats() {
      setStat('muros', Math.min(D.muros.length, Math.floor(S.w * (D.muros.length + 2))));
      setStat('aberturas', Math.floor(S.o * D.aberturas.length + 1e-6));
      setStat('ambientes', Math.min(rooms.length, Math.floor(S.r * (rooms.length + 2))));
      setStat('sup', S.r * D.cubierta, true);
    }
    function renderCmd() { cmdEl.textContent = lines.slice(-3).join('\n'); var cur = document.createElement('span'); cur.className = 'cad-cursor'; cmdEl.appendChild(cur); }
    function say(s) { lines.push(s); renderCmd(); }
    function tween(dur, fn, g) {
      return new Promise(function (res) {
        var t0 = performance.now();
        (function f(now) { if (g !== gen) return; var t = Math.min(1, (now - t0) / dur); fn(t); stats(); draw(); if (t < 1) requestAnimationFrame(f); else res(); })(t0);
      });
    }
    function type(txt, g) {
      lines.push('Comando: '); var at = lines.length - 1;
      return tween(txt.length * 42 + 180, function (t) { lines[at] = 'Comando: ' + txt.slice(0, Math.round(Math.min(1, t * 1.25) * txt.length)); renderCmd(); }, g);
    }
    function tip() { if (info) info.textContent = sel < 0 ? 'Tocá un ambiente para ver su superficie.' : rooms[sel].n + ' · ' + dec(rooms[sel].m2) + ' m² · ' + dec(rooms[sel].w) + ' × ' + dec(rooms[sel].h) + ' m'; }
    function settle() { ++gen; S = { w: 1, o: 1, r: 1, f: 1, c: 1 }; lines = ['Comando: COTAS', chains + ' cadenas de cotas, con sus totales.', 'Comando: ']; stats(); renderCmd(); tip(); draw(); }
    function run() {
      var g = ++gen; S = { w: 0, o: 0, r: 0, f: 0, c: 0 }; sel = -1; lines = []; tip(); renderCmd(); stats(); draw();
      type('MUROS', g)
        .then(function () { return tween(1900, function (t) { S.w = t; }, g); })
        .then(function () { say(D.muros.length + ' muros sobre sus ejes.'); return type('ABERTURAS', g); })
        .then(function () { return tween(1500, function (t) { S.o = t; }, g); })
        .then(function () { say(D.aberturas.length + ' aberturas: ' + nP + ' puertas, ' + nV + ' ventanas, ' + nH + ' pasos.'); return type('AMBIENTES', g); })
        .then(function () { return tween(1300, function (t) { S.r = t; }, g); })
        .then(function () { say(rooms.length + ' ambientes · ' + dec(D.cubierta) + ' m² cubiertos.'); return type('MOBILIARIO', g); })
        .then(function () { return tween(1200, function (t) { S.f = t; }, g); })
        .then(function () { say(D.mobiliario.length + ' bloques.'); return type('COTAS', g); })
        .then(function () { return tween(1200, function (t) { S.c = t; }, g); })
        .then(function () { say(chains + ' cadenas de cotas, con sus totales.'); lines.push('Comando: '); renderCmd(); });
    }

    if (btn.run) btn.run.addEventListener('click', function () { if (reduce) settle(); else run(); });
    ['mob', 'cot'].forEach(function (k) {
      if (btn[k]) btn[k].addEventListener('click', function () { show[k] = !show[k]; btn[k].setAttribute('aria-pressed', show[k] ? 'true' : 'false'); draw(); });
    });
    cv.addEventListener('click', function (e) {
      if (S.r < 1) return;
      var rc = cv.getBoundingClientRect(), wx = bx0 + (e.clientX - rc.left - ox) / ppm, wy = by0 + (oy - (e.clientY - rc.top)) / ppm, hit = -1;
      rooms.forEach(function (r, i) { var xs = r.p.map(function (q) { return q[0]; }), ys = r.p.map(function (q) { return q[1]; }); if (wx >= Math.min.apply(0, xs) && wx <= Math.max.apply(0, xs) && wy >= Math.min.apply(0, ys) && wy <= Math.max.apply(0, ys)) hit = i; });
      sel = hit === sel ? -1 : hit; tip(); draw();
    });

    function size() {
      var r = view.getBoundingClientRect(); if (!r.width || !r.height) return;
      dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); draw();
    }
    if ('ResizeObserver' in window) new ResizeObserver(size).observe(view); else window.addEventListener('resize', size);
    size(); settle();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    if (!reduce && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); run(); } }, { threshold: .45 });
      io.observe(view);
    }
  }
  window.fugaPlanta = fugaPlanta;
})();
