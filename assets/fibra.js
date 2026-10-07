// FUGA Tech · demo de redes.
// Simulación en canvas: de un recorrido a un plano con postes, etiquetas, cotas de vano y láminas.
// El tramo de ejemplo usa los datos ficticios de la demo LISP. El modo dibujo sortea tipos de poste con las mismas proporciones.
(function () {
  'use strict';
  var PI = Math.PI, TAU = PI * 2;
  var PAPER = '#F4F2ED', INK = '#0A0A0A', INKDIM = '#55524C';
  var A1 = 841 / 594, VP_M = 0.81, VP_AR = 1.677;           // lámina A1: ancho útil en metros de papel y proporción de la ventana
  var ESCALAS = [500, 750, 1000, 1500, 2000, 3000, 5000, 10000];
  var CAT = [[0, '12/200 MT', 50], [1, '9/200 MT', 35], [0, '12/200 MT,AP', 27], [0, '12/200 BT,AP', 23], [1, '9/150 BT', 18], [0, '12/200 BT', 17],
    [1, '9/200 BT', 16], [4, '12/AC MT', 12], [0, '12/300 MT,AP', 12], [1, '9/200 MT,BT', 11], [2, '7/150 BT', 11], [3, 'A COLOCAR 9/200 MT', 10]];
  var CAT_SUM = CAT.reduce(function (a, c) { return a + c[2]; }, 0);

  function rng(seed) { return function () { seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function prog(s) { s = Math.round(s); return Math.floor(s / 1000) + '+' + pad(s % 1000, 3); }
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function out(t) { return 1 - Math.pow(1 - t, 3); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function wrap(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }

  function Path(pts) {
    var cum = [0], i;
    for (i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.p = pts; this.cum = cum; this.total = cum[cum.length - 1];
  }
  Path.prototype.at = function (s) {
    var c = this.cum, p = this.p, lo = 0, hi = c.length - 1, m;
    s = clamp(s, 0, this.total);
    while (hi - lo > 1) { m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
    var a = p[lo], b = p[hi], k = (s - c[lo]) / ((c[hi] - c[lo]) || 1);
    return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  };
  Path.prototype.project = function (x, y) {
    var best = 1e18, bs = 0, p = this.p, c = this.cum, i;
    for (i = 1; i < p.length; i++) {
      var ax = p[i - 1][0], ay = p[i - 1][1], dx = p[i][0] - ax, dy = p[i][1] - ay, L2 = dx * dx + dy * dy || 1;
      var k = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1), ex = ax + dx * k - x, ey = ay + dy * k - y, d = ex * ex + ey * ey;
      if (d < best) { best = d; bs = c[i - 1] + Math.sqrt(L2) * k; }
    }
    return bs;
  };

  // Largo aproximado de una etiqueta en metros de dibujo (texto de 5,5 de alto).
  function labelLen(txt) { return (txt.length + 6) * 3.1; }

  function finish(M) {
    var i, j;
    M.path = new Path(M.t); M.total = M.path.total;
    M.poles.forEach(function (p) { if (p.s == null) p.s = M.path.project(p.x, p.y); });
    var k = { a: 0, b: 0, c: 0, ac: 0, col: 0 };
    M.poles.forEach(function (p) { var t = p.txt; if (/^A COLOCAR/.test(t)) k.col++; else if (/\/AC/.test(t)) k.ac++; else if (/^12/.test(t)) k.a++; else if (/^9/.test(t)) k.b++; else k.c++; });
    M.computo = '12 m: ' + k.a + ' · 9 m: ' + k.b + ' · 7,5 m: ' + k.c + ' · Acero: ' + k.ac + ' · A colocar: ' + k.col;
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    function grow(q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    M.t.forEach(grow); M.r.forEach(function (pl) { pl.forEach(grow); });
    M.box = { x0: x0, x1: x1, y0: y0, y1: y1 };

    // Láminas: ventanas a lo largo del recorrido, cada una en la escala normalizada más chica que la contiene.
    var n = Math.max(1, Math.ceil(M.total / 350)), Ls = M.total / n;
    M.sheets = [];
    for (i = 0; i < n; i++) {
      var s0 = i * Ls, s1 = (i + 1) * Ls, a = M.path.at(s0), b = M.path.at(s1), ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (Math.cos(ang) < -1e-6) ang += PI;
      var cs = Math.cos(ang), sn = Math.sin(ang), u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
      var inc = function (x, y) { var dx = x - a.x, dy = y - a.y, u = dx * cs + dy * sn, v = -dx * sn + dy * cs; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); };
      inc(a.x, a.y); inc(b.x, b.y);
      for (j = 0; j < M.t.length; j++) if (M.path.cum[j] > s0 && M.path.cum[j] < s1) inc(M.t[j][0], M.t[j][1]);
      for (j = 0; j < M.poles.length; j++) {
        var p = M.poles[j];
        if (p.s < s0 - 1 || p.s > s1 + 1) continue;
        var r = p.lr * PI / 180, L = labelLen(p.txt);
        inc(p.x, p.y); inc(p.lx, p.ly); inc(p.lx + Math.cos(r) * L, p.ly + Math.sin(r) * L);
        if (j < M.cotas.length) inc(M.cotas[j][0], M.cotas[j][1]);
      }
      u0 -= 22; u1 += 22; v0 -= 18; v1 += 18;
      var esc = ESCALAS[ESCALAS.length - 1];
      for (j = 0; j < ESCALAS.length; j++) if (ESCALAS[j] * VP_M >= u1 - u0 && ESCALAS[j] * VP_M / VP_AR >= v1 - v0) { esc = ESCALAS[j]; break; }
      var uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
      M.sheets.push({ cx: a.x + uc * cs - vc * sn, cy: a.y + uc * sn + vc * cs, ang: ang, w: esc * VP_M, h: esc * VP_M / VP_AR, esc: esc, s0: s0, s1: s1 });
    }
    return M;
  }

  function fromData(D) {
    var M = { t: D.t, r: D.r, cotas: D.c, name: 'tramo_ficticio.dwg', title: 'TRAMO FICTICIO · DEMOSTRACIÓN', custom: false };
    var path = new Path(D.t);
    M.poles = D.p.map(function (p, i) {
      var x = D.x[i], o = { k: p[0], x: p[1], y: p[2], rot: p[3], lx: x[0], ly: x[1], lr: x[2], txt: x[3] };
      var q = path.at(path.project(o.x, o.y)), r = o.lr * PI / 180;
      if ((q.x - o.x) * Math.cos(r) + (q.y - o.y) * Math.sin(r) > 0) { o.lx = 2 * o.x - o.lx; o.ly = 2 * o.y - o.ly; o.lr += 180; }   // la etiqueta siempre se aleja del recorrido
      return o;
    });
    finish(M);
    M.fly0 = Math.max(0, M.poles[Math.min(236, M.poles.length - 1)].s - 20); M.sel0 = sheetAt(M, M.poles[Math.min(247, M.poles.length - 1)].s);
    return M;
  }
  function sheetAt(M, s) { for (var i = 0; i < M.sheets.length; i++) if (s <= M.sheets[i].s1) return i; return M.sheets.length - 1; }

  // Ramer-Douglas-Peucker: deja el trazo a mano como una poligonal de tramos rectos.
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    var keep = [], st = [[0, pts.length - 1]], i;
    keep[0] = keep[pts.length - 1] = true;
    while (st.length) {
      var seg = st.pop(), a = pts[seg[0]], b = pts[seg[1]], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, md = 0, mi = -1;
      for (i = seg[0] + 1; i < seg[1]; i++) { var d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / L; if (d > md) { md = d; mi = i; } }
      if (md > tol) { keep[mi] = true; st.push([seg[0], mi], [mi, seg[1]]); }
    }
    return pts.filter(function (_, j) { return keep[j]; });
  }

  function fromStroke(raw, tol) {
    var t = simplify(raw, tol), path = new Path(t), R = rng(Math.round(path.total * 7) + t.length), i, j;
    var must = [0];
    for (i = 1; i < t.length - 1; i++) {
      var turn = Math.abs(wrap(Math.atan2(t[i + 1][1] - t[i][1], t[i + 1][0] - t[i][0]) - Math.atan2(t[i][1] - t[i - 1][1], t[i][0] - t[i - 1][0])));
      if (turn > .2 && path.cum[i] - must[must.length - 1] > 22 && path.total - path.cum[i] > 22) must.push(path.cum[i]);
    }
    must.push(path.total);
    var ss = [0];
    for (i = 1; i < must.length; i++) {
      var g = must[i] - must[i - 1], n = Math.max(1, Math.round(g / 56));
      for (j = 1; j < n; j++) ss.push(must[i - 1] + g * (j + (R() - .5) * .42) / n);
      ss.push(must[i]);
    }
    function normal(s) {            // normal izquierda, promediada cerca de un quiebre para que el poste caiga en la bisectriz
      var a = path.at(Math.max(0, s - 1.5)).a, b = path.at(Math.min(path.total, s + 1.5)).a, m = a + wrap(b - a) / 2;
      return { a: m, nx: -Math.sin(m), ny: Math.cos(m) };
    }
    var M = { t: t, r: [], cotas: [], poles: [], name: 'tu_recorrido.dwg', title: 'RECORRIDO DIBUJADO EN PANTALLA', custom: true };
    ss.forEach(function (s) {
      var q = path.at(s), nm = normal(s), pick = R() * CAT_SUM, c = CAT[0];
      for (j = 0; j < CAT.length; j++) { pick -= CAT[j][2]; if (pick <= 0) { c = CAT[j]; break; } }
      var deg = nm.a * 180 / PI;
      M.poles.push({ k: c[0], x: q.x + nm.nx * 11, y: q.y + nm.ny * 11, rot: (c[0] === 0 || c[0] === 4) ? deg : deg + 90, lx: q.x + nm.nx * 19, ly: q.y + nm.ny * 19, lr: deg + 90, txt: c[1], s: s, qx: q.x, qy: q.y, nx: nm.nx, ny: nm.ny });
    });
    for (i = 0; i < M.poles.length - 1; i++) {
      var p1 = M.poles[i], p2 = M.poles[i + 1], nx = (p1.nx + p2.nx) / 2, ny = (p1.ny + p2.ny) / 2, nl = Math.hypot(nx, ny) || 1;
      M.cotas.push([(p1.qx + p2.qx) / 2 - nx / nl * 19, (p1.qy + p2.qy) / 2 - ny / nl * 19]);
    }
    finish(M); M.fly0 = 0; M.sel0 = 0;
    return M;
  }

  function fugaFibra(root, D) {
    var cv = root.querySelector('canvas'), ctx = cv.getContext('2d'), view = root.querySelector('.cad-view');
    var cmdEl = root.querySelector('.cad-cmd'), comp = root.querySelector('[data-t="computo"]'), fileEl = root.querySelector('[data-t="file"]'), sheetEl = root.querySelector('[data-t="sheet"]');
    var stat = {}; [].forEach.call(root.querySelectorAll('[data-n]'), function (e) { stat[e.getAttribute('data-n')] = e; });
    var btn = {}; [].forEach.call(root.querySelectorAll('[data-act]'), function (e) { btn[e.getAttribute('data-act')] = e; });
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var cst = getComputedStyle(root);
    function col(n, d) { var v = cst.getPropertyValue(n).trim(); return v || d; }
    var C = { bg: col('--cad-bg', '#0A0A0A'), ln: col('--cad-line', '#F4F2ED'), dm: col('--cad-dim', '#A29E96') };
    var W = 0, H = 0, dpr = 1, gen = 0, mode = 'model', lines = [];
    var EX = fromData(D), M = EX, sel = EX.sel0;
    var S, camA = 0, stroke = null, drawing = false, hint = '';

    function done() { return { route: 1, poles: 1, lab: 1, cot: 1, fl: 1e12, fc: 1e12, z: 0, s: M.fly0, frames: 1, comp: 1, cotN: M.cotas.length, from: null, ft: 1 }; }
    S = done();

    // ---------- geometría de pantalla ----------
    function lay() {
      var g = 10, pw = Math.min(W - 2 * g, (H - Math.max(84, H * .2) - 3 * g) * A1), ph = pw / A1, sh = H - ph - 3 * g;
      return { key: { x: g, y: g, w: W - 2 * g, h: sh }, paper: { x: (W - pw) / 2, y: sh + 2 * g, w: pw, h: ph } };
    }
    function mainRect() {
      var k = lay().key, t = ease(S.comp);
      return { x: k.x * t, y: k.y * t, w: W + (k.w - W) * t, h: H + (k.h - H) * t };
    }
    function camOver(R) {
      var b = M.box, bw = Math.max(b.x1 - b.x0, 60), bh = Math.max(b.y1 - b.y0, 60), m = Math.min(R.w, R.h) < 200 ? 16 : 34;
      return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, ppm: Math.min((R.w - 2 * m) / bw, (R.h - 2 * m) / bh, 3), rot: 0 };
    }
    function camDet(R) {
      var q = M.path.at(S.s);
      camA += wrap(q.a - camA) * .09;
      return { cx: q.x - Math.sin(camA) * 38, cy: q.y + Math.cos(camA) * 38, ppm: clamp(Math.min(R.w / 170, R.h / 150), 1.6, 3.6), rot: 0 };
    }
    function camMain(R) {
      var a = camOver(R), c = a;
      if (S.z > 0) {
        var b = camDet(R), t = ease(S.z), ppm = Math.exp(Math.log(a.ppm) + (Math.log(b.ppm) - Math.log(a.ppm)) * t);
        var k = Math.abs(a.ppm - b.ppm) < 1e-9 ? t : (1 / a.ppm - 1 / ppm) / (1 / a.ppm - 1 / b.ppm);
        c = { cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k, ppm: ppm, rot: 0 };
      }
      if (S.from && S.ft < 1) {
        var f = S.from, e = ease(S.ft);
        c = { cx: f.cx + (c.cx - f.cx) * e, cy: f.cy + (c.cy - f.cy) * e, ppm: Math.exp(Math.log(f.ppm) + (Math.log(c.ppm) - Math.log(f.ppm)) * e), rot: 0 };
      }
      return c;
    }
    function camDraw() { var mpp = 2400 / W; return { cx: W * mpp / 2, cy: H * mpp / 2, ppm: 1 / mpp, rot: 0 }; }

    // ---------- pintura del modelo ----------
    function paint(R, cam, o) {
      var cs = Math.cos(cam.rot), sn = Math.sin(cam.rot), ppm = cam.ppm, ox = R.x + R.w / 2, oy = R.y + R.h / 2, i, p, sx, sy, s;
      function X(x, y) { return ox + ((x - cam.cx) * cs + (y - cam.cy) * sn) * ppm; }
      function Y(x, y) { return oy - (-(x - cam.cx) * sn + (y - cam.cy) * cs) * ppm; }
      function vis(x, y, m) { return x > R.x - m && x < R.x + R.w + m && y > R.y - m && y < R.y + R.h + m; }
      ctx.save(); ctx.beginPath(); ctx.rect(R.x, R.y, R.w, R.h); ctx.clip();
      if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(R.x, R.y, R.w, R.h); }

      if (o.grid) {                 // grilla de coordenadas y barra de escala
        var G = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000], g = G[G.length - 1];
        for (i = 0; i < G.length; i++) if (G[i] * ppm >= 56) { g = G[i]; break; }
        var hw = R.w / 2 / ppm, hh = R.h / 2 / ppm, gx = Math.floor((cam.cx - hw) / g) * g, gy = Math.floor((cam.cy - hh) / g) * g;
        ctx.strokeStyle = o.ln; ctx.globalAlpha = .11; ctx.lineWidth = 1; ctx.beginPath();
        for (s = gx; s < cam.cx + hw + g; s += g) { sx = Math.round(X(s, cam.cy)) + .5; ctx.moveTo(sx, R.y); ctx.lineTo(sx, R.y + R.h); }
        for (s = gy; s < cam.cy + hh + g; s += g) { sy = Math.round(Y(cam.cx, s)) + .5; ctx.moveTo(R.x, sy); ctx.lineTo(R.x + R.w, sy); }
        ctx.stroke(); ctx.globalAlpha = 1;
        if (R.h > 150) {
          var bx = R.x + 12, by = R.y + R.h - 12;
          ctx.strokeStyle = o.dm; ctx.fillStyle = o.dm; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by); ctx.lineTo(bx + g * ppm, by); ctx.lineTo(bx + g * ppm, by - 5); ctx.stroke();
          ctx.font = '700 10px Archivo, Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(fmt(g) + ' m', bx + 5, by - 5);
        }
      }

      if (o.frames > 0) {           // ventanas de lámina sobre el recorrido
        var nf = Math.floor(o.frames * M.sheets.length + 1e-6);
        for (i = 0; i < nf; i++) {
          var f = M.sheets[i], fc = Math.cos(f.ang), fs = Math.sin(f.ang), on = i === o.sel;
          ctx.beginPath();
          [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c, j) {
            var wx = f.cx + c[0] * f.w / 2 * fc - c[1] * f.h / 2 * fs, wy = f.cy + c[0] * f.w / 2 * fs + c[1] * f.h / 2 * fc;
            if (j) ctx.lineTo(X(wx, wy), Y(wx, wy)); else ctx.moveTo(X(wx, wy), Y(wx, wy));
          });
          ctx.closePath();
          if (on) {
            ctx.fillStyle = o.ln; ctx.globalAlpha = .9; ctx.fill(); ctx.globalAlpha = 1;
            if (f.w * ppm < 26) { ctx.strokeStyle = o.ln; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(f.cx, f.cy), Y(f.cx, f.cy), 11, 0, TAU); ctx.stroke(); }
          }
          else { ctx.strokeStyle = o.ln; ctx.globalAlpha = .55; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1; }
        }
      }

      // recorrido
      var lim = o.route * M.total, t = M.t, cum = M.path.cum, a, b, k;
      ctx.strokeStyle = o.ln; ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
      if (lim > 0) {
        ctx.lineWidth = Math.max(o.thin ? 1.2 : 1.8, .8 * ppm);
        ctx.beginPath(); ctx.moveTo(X(t[0][0], t[0][1]), Y(t[0][0], t[0][1]));
        for (i = 1; i < t.length && cum[i - 1] < lim; i++) {
          a = t[i - 1]; b = t[i]; k = Math.min(1, (lim - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1));
          ctx.lineTo(X(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k), Y(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k));
        }
        ctx.stroke();
      }
      if (o.route >= 1) {
        ctx.lineWidth = Math.max(1, .5 * ppm);
        M.r.forEach(function (pl) { ctx.beginPath(); pl.forEach(function (q, j) { if (j) ctx.lineTo(X(q[0], q[1]), Y(q[0], q[1])); else ctx.moveTo(X(q[0], q[1]), Y(q[0], q[1])); }); ctx.stroke(); });
      }
      if (o.sel != null && o.frames > 0 && o.selLine) {   // el tramo de la lámina elegida, en el color del fondo
        var fsel = M.sheets[o.sel];
        if (fsel) {
          ctx.strokeStyle = o.bgc; ctx.lineWidth = 2; ctx.beginPath();
          for (s = fsel.s0, i = 0; s <= fsel.s1 + .01; s += (fsel.s1 - fsel.s0) / 12, i++) { p = M.path.at(s); if (i) ctx.lineTo(X(p.x, p.y), Y(p.x, p.y)); else ctx.moveTo(X(p.x, p.y), Y(p.x, p.y)); }
          ctx.stroke();
        }
      }

      // postes: marca a escala general, bloque en detalle
      var n = Math.floor(o.poles * M.poles.length + 1e-6), full = o.detail || ppm >= .45;
      if (!full) {
        ctx.fillStyle = o.ln;
        var hl = R.h < 200 ? 2.5 : 3.5;
        for (i = 0; i < n; i++) {
          p = M.poles[i]; sx = X(p.x, p.y); sy = Y(p.x, p.y);
          var r = (p.lr * PI / 180) - cam.rot;
          ctx.beginPath(); ctx.moveTo(sx - Math.cos(r) * hl, sy + Math.sin(r) * hl); ctx.lineTo(sx + Math.cos(r) * hl, sy - Math.sin(r) * hl);
          ctx.strokeStyle = o.ln; ctx.lineWidth = R.h < 200 ? 1 : 2; ctx.stroke();
        }
      } else {
        s = Math.max(3 * ppm, o.minSym || 0); ctx.strokeStyle = o.ln; ctx.lineWidth = Math.max(1, .1 * s);
        for (i = 0; i < n; i++) {
          p = M.poles[i]; sx = X(p.x, p.y); sy = Y(p.x, p.y);
          if (!vis(sx, sy, 40)) continue;
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(-(p.rot * PI / 180 - cam.rot)); ctx.beginPath();
          if (p.k === 0) { ctx.arc(0, 0, .45 * s, 0, TAU); ctx.moveTo(-1.3 * s, -.35 * s); ctx.lineTo(1.3 * s, -.35 * s); ctx.moveTo(-s, .35 * s); ctx.lineTo(s, .35 * s); }
          else if (p.k === 1) { ctx.arc(0, 0, .4 * s, 0, TAU); ctx.moveTo(-1.1 * s, 0); ctx.lineTo(1.1 * s, 0); }
          else if (p.k === 2) { ctx.arc(0, 0, .35 * s, 0, TAU); ctx.moveTo(-.8 * s, 0); ctx.lineTo(.8 * s, 0); }
          else if (p.k === 3) { ctx.arc(0, 0, .4 * s, 0, TAU); ctx.moveTo(.72 * s, 0); ctx.arc(0, 0, .72 * s, 0, TAU); ctx.moveTo(-1.1 * s, 0); ctx.lineTo(1.1 * s, 0); }
          else { ctx.rect(-.5 * s, -.5 * s, s, s); ctx.moveTo(-1.2 * s, 0); ctx.lineTo(1.2 * s, 0); }
          ctx.stroke(); ctx.restore();
        }
      }
      if (!o.detail && ppm < .9) { ctx.restore(); return; }

      // cotas de vano
      var fz = Math.max(7.5 * ppm * .8, o.minFont || 0);
      ctx.strokeStyle = o.dm; ctx.fillStyle = o.dm; ctx.lineWidth = 1;
      ctx.font = fz.toFixed(1) + 'px Arial, Helvetica, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      if (o.cot) for (i = 0; i < M.cotas.length; i++) {
        var p1 = M.poles[i], p2 = M.poles[i + 1], q = M.cotas[i];
        if (p2.s > o.fc) break;
        var dx = p2.x - p1.x, dy = p2.y - p1.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
        var s1 = (p1.x - q[0]) * ux + (p1.y - q[1]) * uy, s2 = (p2.x - q[0]) * ux + (p2.y - q[1]) * uy;
        var wx1 = q[0] + ux * s1, wy1 = q[1] + uy * s1, wx2 = q[0] + ux * s2, wy2 = q[1] + uy * s2;
        var ax = X(wx1, wy1), ay = Y(wx1, wy1), bx2 = X(wx2, wy2), by2 = Y(wx2, wy2);
        if (!vis(ax, ay, 80) && !vis(bx2, by2, 80)) continue;
        ctx.beginPath(); ctx.moveTo(X(p1.x, p1.y), Y(p1.x, p1.y)); ctx.lineTo(ax, ay); ctx.lineTo(bx2, by2); ctx.lineTo(X(p2.x, p2.y), Y(p2.x, p2.y)); ctx.stroke();
        var ang = Math.atan2(by2 - ay, bx2 - ax), dpx = Math.hypot(bx2 - ax, by2 - ay), h = Math.min(3.5 * ppm, dpx / 3);
        [[ax, ay, 1], [bx2, by2, -1]].forEach(function (e) {
          ctx.save(); ctx.translate(e[0], e[1]); ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(e[2] * h, -h * .22); ctx.lineTo(e[2] * h, h * .22); ctx.closePath(); ctx.fill(); ctx.restore();
        });
        if (dpx > fz * 1.3) { ctx.save(); ctx.translate((ax + bx2) / 2, (ay + by2) / 2); ctx.rotate(Math.abs(ang) > PI / 2 ? ang + PI : ang); ctx.fillText(String(Math.round(L)), 0, -.8 * ppm - 2); ctx.restore(); }
      }

      // etiquetas
      fz = Math.max(5 * ppm * 1.1, o.minFont || 0);
      ctx.fillStyle = o.ln; ctx.font = fz.toFixed(1) + 'px Arial, Helvetica, sans-serif'; ctx.textBaseline = 'middle';
      if (o.lab) for (i = 0; i < M.poles.length; i++) {
        p = M.poles[i];
        if (p.s > o.fl) break;
        sx = X(p.lx, p.ly); sy = Y(p.lx, p.ly);
        if (!vis(sx, sy, 160)) continue;
        var ra = -(p.lr * PI / 180 - cam.rot), flip = Math.cos(ra) < -.02;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(flip ? ra + PI : ra); ctx.textAlign = flip ? 'right' : 'left';
        ctx.fillText('P-' + pad(i + 1, 3) + ' ' + p.txt, 0, 0); ctx.restore();
      }
      ctx.restore();
    }

    // ---------- lámina en papel ----------
    function paintSheet(P, k, alpha) {
      var f = M.sheets[k]; if (!f) return;
      var pw = P.w, ph = P.h, x = P.x, y = P.y + (1 - alpha) * 24, m = pw * .018, tb = ph * .135;
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.fillStyle = PAPER; ctx.fillRect(x, y, pw, ph);
      var V = { x: x + m, y: y + m, w: pw - 2 * m, h: ph - 2 * m - tb };
      paint(V, { cx: f.cx, cy: f.cy, ppm: V.w / f.w, rot: f.ang }, { ln: INK, dm: INKDIM, route: 1, poles: 1, lab: 1, cot: 1, fl: 1e12, fc: 1e12, detail: true, minFont: pw < 500 ? 4.6 : 6, minSym: pw < 500 ? 2.6 : 0, frames: 0 });
      ctx.globalAlpha = alpha;

      // empalmes con las láminas vecinas y norte
      var cs = Math.cos(f.ang), sn = Math.sin(f.ang), ppm = V.w / f.w, f1 = Math.max(5, pw * .0105), f2 = Math.max(7, pw * .019);
      function sxy(wx, wy) { return [V.x + V.w / 2 + ((wx - f.cx) * cs + (wy - f.cy) * sn) * ppm, V.y + V.h / 2 - (-(wx - f.cx) * sn + (wy - f.cy) * cs) * ppm]; }
      ctx.save(); ctx.beginPath(); ctx.rect(V.x, V.y, V.w, V.h); ctx.clip();
      ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 1; ctx.setLineDash([6, 4]); ctx.font = '700 ' + f1.toFixed(1) + 'px Archivo, Arial, sans-serif'; ctx.textBaseline = 'top';
      [[f.s0, k, 'left', 4], [f.s1, k + 2, 'right', -4]].forEach(function (e) {
        if ((e[1] === k && k === 0) || (e[1] === k + 2 && k === M.sheets.length - 1)) return;
        var q = M.path.at(e[0]), c = sxy(q.x, q.y);
        ctx.beginPath(); ctx.moveTo(Math.round(c[0]) + .5, V.y); ctx.lineTo(Math.round(c[0]) + .5, V.y + V.h); ctx.stroke();
        ctx.textAlign = e[2]; ctx.fillText('EMPALME LÁM. ' + pad(e[1], 2), c[0] + e[3], V.y + 5);
      });
      ctx.setLineDash([]);
      var nr = Math.max(9, pw * .022), nxp = V.x + V.w - nr * 1.8, nyp = V.y + V.h - nr * 1.9;
      ctx.save(); ctx.translate(nxp, nyp); ctx.rotate(f.ang);
      ctx.beginPath(); ctx.moveTo(0, -nr); ctx.lineTo(nr * .42, nr * .7); ctx.lineTo(0, nr * .35); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -nr); ctx.lineTo(-nr * .42, nr * .7); ctx.lineTo(0, nr * .35); ctx.closePath(); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('N', 0, -nr - 2); ctx.restore();
      ctx.restore();

      // marco y rótulo
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, pw * .0022); ctx.strokeRect(x + m, y + m, pw - 2 * m, ph - 2 * m);
      var ty = y + ph - m - tb, cw = [.2, .33, .21, .12, .14], cx0 = x + m, i, small = pw < 430;
      ctx.beginPath(); ctx.moveTo(x + m, ty); ctx.lineTo(x + pw - m, ty); ctx.stroke();
      var cells = [
        ['FUGA TECH', 'AUTOMATIZACIÓN DE DIBUJO CAD', 1],
        ['PLANO', 'RECORRIDO DE FIBRA ÓPTICA', 0, M.title],
        ['PROGRESIVA', prog(f.s0) + ' A ' + prog(f.s1), 0],
        ['ESCALA', '1:' + fmt(f.esc), 0],
        ['LÁMINA', pad(k + 1, 2) + '/' + pad(M.sheets.length, 2), 2]
      ];
      ctx.lineWidth = 1; ctx.textAlign = 'left'; ctx.fillStyle = INK;
      for (i = 0; i < cells.length; i++) {
        var w = (pw - 2 * m) * cw[i], c = cells[i], px = cx0 + pw * .012;
        if (i) { ctx.beginPath(); ctx.moveTo(Math.round(cx0) + .5, ty); ctx.lineTo(Math.round(cx0) + .5, ty + tb); ctx.stroke(); }
        ctx.save(); ctx.beginPath(); ctx.rect(cx0, ty, w - 2, tb); ctx.clip(); ctx.textBaseline = 'alphabetic';
        if (c[2] === 1) {
          ctx.font = '800 ' + (f2 * (small ? 1.15 : 1.45)).toFixed(1) + 'px Archivo, Arial, sans-serif'; ctx.fillText(c[0], px, ty + tb * (small ? .64 : .56));
          if (!small) { ctx.font = '700 ' + (f1 * .92).toFixed(1) + 'px Archivo, Arial, sans-serif'; ctx.fillText(c[1], px, ty + tb * .82); }
        } else {
          var two = c[3] && !small;
          ctx.fillStyle = INKDIM; ctx.font = '700 ' + f1.toFixed(1) + 'px Archivo, Arial, sans-serif'; ctx.fillText(c[0], px, ty + tb * .3);
          ctx.fillStyle = INK; ctx.font = '800 ' + (c[2] === 2 ? f2 * 1.45 : (small && i === 1 ? f2 * .86 : f2)).toFixed(1) + 'px Archivo, Arial, sans-serif'; ctx.fillText(c[1], px, ty + tb * (two ? .58 : .72));
          if (two) { ctx.font = '700 ' + f1.toFixed(1) + 'px Archivo, Arial, sans-serif'; ctx.fillStyle = INKDIM; ctx.fillText(c[3], px, ty + tb * .84); ctx.fillStyle = INK; }
        }
        ctx.restore();
        cx0 += w;
      }
      ctx.restore();
    }

    // ---------- cuadro ----------
    function draw() {
      if (!W || !H) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      if (mode === 'draw') {
        var cd = camDraw(), mpp = 1 / cd.ppm;
        var saved = M; M = { t: [[0, 0], [0, 0]], r: [], poles: [], cotas: [], sheets: [], total: 0, path: { cum: [0, 0] } };
        paint({ x: 0, y: 0, w: W, h: H }, cd, { ln: C.ln, dm: C.dm, grid: true, route: 0, poles: 0, frames: 0 });
        M = saved;
        if (stroke && stroke.length > 1) {
          ctx.strokeStyle = C.ln; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
          stroke.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.stroke();
          var px = 0; for (var i = 1; i < stroke.length; i++) px += Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]);
          setStat('len', px * mpp);
        } else {
          ctx.fillStyle = C.ln; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = '800 ' + clamp(W * .058, 20, 40).toFixed(0) + 'px Archivo, Arial, sans-serif'; ctx.fillText('DIBUJÁ UN RECORRIDO', W / 2, H / 2 - 12);
          ctx.fillStyle = C.dm; ctx.font = '700 ' + clamp(W * .03, 11, 14).toFixed(0) + 'px Archivo, Arial, sans-serif'; ctx.fillText(hint || 'CON EL DEDO O EL MOUSE, DE UN SOLO TRAZO', W / 2, H / 2 + 22);
        }
        return;
      }
      var R = mainRect(), L = lay(), key = S.comp > .5;
      paint(R, camMain(R), { ln: C.ln, dm: C.dm, bgc: C.bg, grid: !key, thin: key, route: S.route, poles: S.poles, lab: S.lab, cot: S.cot, fl: S.fl, fc: S.fc, frames: S.frames, sel: S.comp > 0 ? sel : null, selLine: true });
      if (S.comp > 0) paintSheet(L.paper, sel, ease(S.comp));
    }

    // ---------- textos ----------
    function setStat(k, v) { if (stat[k]) stat[k].textContent = fmt(v); }
    function stats() { setStat('len', S.route * M.total); setStat('poles', Math.floor(S.poles * M.poles.length + 1e-6)); setStat('cotas', S.cotN); setStat('sheets', Math.floor(S.frames * M.sheets.length + 1e-6)); }
    function renderCmd() {
      cmdEl.textContent = lines.slice(-3).join('\n');
      var cur = document.createElement('span'); cur.className = 'cad-cursor'; cmdEl.appendChild(cur);
    }
    function say(s) { lines.push(s); renderCmd(); }
    function nav() {
      if (sheetEl) sheetEl.textContent = mode === 'draw' ? 'Lámina —' : 'Lámina ' + pad(sel + 1, 2) + '/' + pad(M.sheets.length, 2);
      var onn = mode === 'model' && S.comp >= 1;
      if (btn.prev) btn.prev.disabled = !onn; if (btn.next) btn.next.disabled = !onn;
      if (btn.run) btn.run.textContent = M.custom || mode === 'draw' ? 'Volver al ejemplo' : 'Correr de nuevo';
      if (btn.draw) btn.draw.textContent = mode === 'draw' ? 'Cancelar' : (M.custom ? 'Dibujar otro' : 'Dibujar mi recorrido');
      if (fileEl) fileEl.textContent = 'Modelo · ' + (mode === 'draw' ? 'nuevo.dwg' : M.name);
    }
    function fin() {
      return ['Comando: COTAS', fmt(M.cotas.length) + ' cotas de vano.', 'Comando: LAMINAS', fmt(M.sheets.length) + ' láminas A1 armadas.', 'Comando: '];
    }
    function settle() { ++gen; mode = 'model'; S = done(); lines = fin(); if (comp) { comp.textContent = M.computo; comp.classList.add('on'); } stats(); renderCmd(); nav(); draw(); }

    // ---------- animación ----------
    function tween(dur, fn, g) {
      return new Promise(function (res) {
        var t0 = performance.now();
        (function f(now) {
          if (g !== gen) return;
          var t = Math.min(1, (now - t0) / dur); fn(t); stats(); draw();
          if (t < 1) requestAnimationFrame(f); else res();
        })(t0);
      });
    }
    function type(txt, g) {
      lines.push('Comando: '); var at = lines.length - 1;
      return tween(txt.length * 42 + 180, function (t) { lines[at] = 'Comando: ' + txt.slice(0, Math.round(Math.min(1, t * 1.25) * txt.length)); renderCmd(); }, g);
    }

    function run(from) {
      var g = ++gen, s0 = M.fly0, fl = Math.min(900, Math.max(60, (M.total - s0) * .85)), N = M.cotas.length, hw = W / 2 / clamp(Math.min(W / 170, H / 150), 1.6, 3.6);
      mode = 'model'; view.classList.remove('is-draw');
      S = { route: 0, poles: 0, lab: 0, cot: 0, fl: -1, fc: -1, z: 0, s: s0, frames: 0, comp: 0, cotN: 0, from: from || null, ft: from ? 0 : 1 };
      camA = M.path.at(s0).a; lines = []; sel = M.sel0;
      if (comp) { comp.textContent = M.computo; comp.classList.remove('on'); }
      nav(); renderCmd(); stats(); draw();
      type('RECORRIDO', g)
        .then(function () { return tween(1500, function (t) { S.route = out(t); S.ft = Math.min(1, t * 2.2); }, g); })
        .then(function () { say('Recorrido: ' + M.t.length + ' vértices · ' + fmt(M.total) + ' m.'); return type('POSTES', g); })
        .then(function () { return tween(1300, function (t) { S.poles = t; }, g); })
        .then(function () { say(fmt(M.poles.length) + ' postes, por tipo y altura.'); return tween(1300, function (t) { S.z = t; }, g); })
        .then(function () { return type('ETIQUETAS', g); })
        .then(function () { S.lab = 1; return tween(2300, function (t) { S.s = s0 + fl * .5 * t; S.fl = S.s + hw * (.15 + .6 * t); }, g); })
        .then(function () { say(fmt(M.poles.length) + ' etiquetas, sin pisarse.'); return type('COTAS', g); })
        .then(function () { S.cot = 1; var c0 = s0 + fl * .5 - hw * 1.3; return tween(2500, function (t) { S.s = s0 + fl * (.5 + .5 * t); S.fl = S.s + hw * .75; S.fc = c0 + (S.s + hw * .7 - c0) * Math.min(1, t * 1.6); S.cotN = Math.round(N * out(t)); }, g); })
        .then(function () { S.fl = S.fc = 1e12; S.cotN = N; say(fmt(N) + ' cotas de vano.'); return tween(1200, function (t) { S.z = 1 - t; }, g); })
        .then(function () { return type('LAMINAS', g); })
        .then(function () { return tween(1300, function (t) { S.frames = t; }, g); })
        .then(function () { say(fmt(M.sheets.length) + ' láminas A1 armadas.'); return tween(1100, function (t) { S.comp = t; }, g); })
        .then(function () { if (comp) comp.classList.add('on'); lines.push('Comando: '); renderCmd(); nav(); draw(); });
    }

    // ---------- interacción ----------
    function goto(k) { var n = M.sheets.length; sel = ((k % n) + n) % n; nav(); draw(); }
    function startDraw() { ++gen; mode = 'draw'; stroke = null; hint = ''; view.classList.add('is-draw'); lines = ['Comando: RECORRIDO', 'Designe el recorrido: ']; if (comp) comp.classList.remove('on'); ['poles', 'cotas', 'sheets', 'len'].forEach(function (k) { setStat(k, 0); }); renderCmd(); nav(); draw(); }
    function example() { M = EX; view.classList.remove('is-draw'); if (reduce) settle(); else run(); }
    if (btn.run) btn.run.addEventListener('click', example);
    if (btn.draw) btn.draw.addEventListener('click', function () { if (mode === 'draw') { M = M || EX; settle(); view.classList.remove('is-draw'); } else startDraw(); });
    if (btn.prev) btn.prev.addEventListener('click', function () { goto(sel - 1); });
    if (btn.next) btn.next.addEventListener('click', function () { goto(sel + 1); });

    function pos(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    cv.addEventListener('pointerdown', function (e) {
      if (mode !== 'draw') return;
      e.preventDefault(); drawing = true; stroke = [pos(e)]; try { cv.setPointerCapture(e.pointerId); } catch (x) {} draw();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var q = pos(e), l = stroke[stroke.length - 1];
      if (Math.hypot(q[0] - l[0], q[1] - l[1]) >= 3) { stroke.push(q); draw(); }
    });
    function endStroke() {
      if (!drawing) return;
      drawing = false;
      var px = 0, i; for (i = 1; i < stroke.length; i++) px += Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]);
      if (px < 110) { stroke = null; hint = 'UN POCO MÁS LARGO'; setStat('len', 0); draw(); return; }
      var cd = camDraw(), mpp = 1 / cd.ppm;
      M = fromStroke(stroke.map(function (q) { return [q[0] * mpp, (H - q[1]) * mpp]; }), 4 * mpp);
      stroke = null;
      if (reduce) settle(); else run(cd);
    }
    cv.addEventListener('pointerup', endStroke); cv.addEventListener('pointercancel', endStroke);
    cv.addEventListener('click', function (e) {
      if (mode !== 'model' || S.comp < 1) return;
      var q = pos(e), L = lay(), P = L.paper;
      if (q[1] >= P.y && q[0] >= P.x && q[0] <= P.x + P.w) { goto(sel + (q[0] > P.x + P.w / 2 ? 1 : -1)); return; }
      var R = L.key, c = camOver(R), best = 1e9, bi = -1;
      M.sheets.forEach(function (f, i) { var d = Math.hypot(R.x + R.w / 2 + (f.cx - c.cx) * c.ppm - q[0], R.y + R.h / 2 - (f.cy - c.cy) * c.ppm - q[1]); if (d < best) { best = d; bi = i; } });
      if (bi >= 0 && best < 60) goto(bi);
    });

    function size() {
      var r = view.getBoundingClientRect();
      if (!r.width || !r.height) return;
      dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); draw();
    }
    if ('ResizeObserver' in window) new ResizeObserver(size).observe(view); else window.addEventListener('resize', size);
    size(); settle();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);

    if (!reduce && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); if (mode === 'model' && !M.custom) run(); } }, { threshold: .5 });
      io.observe(view);
    }
  }
  window.fugaFibra = fugaFibra;
})();
