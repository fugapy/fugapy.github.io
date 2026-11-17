// Pantalla del cómputo FUGA: sube el plano al servidor y muestra lo que vuelve. Acá no se calcula nada: las medidas, las fórmulas y los
// precios están en el servidor. Todo el texto se arma con textContent (nada del plano entra como HTML).
(function () {
  'use strict';

  const token = 'demo';
  const $ = (id) => document.getElementById(id);
  let nombre = '';
  let reglasAceptadas = false;
  let aceptando = false;

  // ---------- armado del DOM ----------
  function el(tag, props, ...hijos) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v);
    }
    for (const h of hijos.flat()) if (h != null && h !== false) n.append(h instanceof Node ? h : document.createTextNode(String(h)));
    return n;
  }

  // ---------- números en castellano de Paraguay ----------
  const miles = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const gs = (n) => (n == null ? '—' : miles(n));
  function cant(n) {
    if (n == null) return '—';
    if (typeof n === 'string') return n;
    const r = Math.round(n * 100) / 100;
    const [e, d] = Math.abs(r).toFixed(2).split('.');
    const s = (r < 0 ? '-' : '') + miles(Number(e)) + (d === '00' ? '' : ',' + d.replace(/0$/, ''));
    return s;
  }
  function fecha(iso) {
    const d = new Date(iso);
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `${d.getDate()} de ${meses[d.getMonth()]} a las ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // estado de una medida o renglón: ok (medido), duda (valor con falta), falta (sin valor)
  const estadoDe = (valor, falta) => (!falta ? 'ok' : valor != null ? 'duda' : 'falta');
  const ESTADO = { ok: 'Medido', duda: 'A confirmar', falta: 'Falta' };
  const etiqueta = (e) => el('span', { class: 'estado ' + e, text: ESTADO[e] });

  // ---------- marca de agua con el nombre del link ----------
  function marcaDeAgua() {
    const t = `${nombre} · FUGA · ${new Date().toLocaleDateString('es-PY')}`.replace(/[<>&"]/g, '');
    // el azul de la marca del tema (claro u oscuro)
    const color = (getComputedStyle(document.documentElement).getPropertyValue('--tech').trim() || '#004ED8').replace(/[^#0-9A-Fa-f]/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="240"><text x="20" y="140" transform="rotate(-18 280 120)" ` +
      `font-family="Archivo, Arial, sans-serif" font-weight="800" font-size="22" fill="${color}">${t}</text></svg>`;
    $('marca').style.backgroundImage = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  }

  // ---------- reglas de uso (versión 2026-10-30b; si cambia el texto, cambia REGLAS en servidor.js) ----------
  const REGLAS = [
    ['Qué es', 'Una herramienta de FUGA que lee tu plano en DWG o DXF y arma el cómputo métrico con las fórmulas del estudio y los ' +
      'precios de la última edición de la Revista COSTOS. El total es el costo directo: los precios de los materiales traen su IVA y se ' +
      'suma el 10 % de IVA de la mano de obra. No incluye tu margen ni imprevistos.'],
    ['Es una ayuda, no reemplaza tu revisión', 'Revisá las cantidades antes de presupuestar, contratar o firmar. Lo que la app no pudo ' +
      'medir aparece como falta y no entra al total. FUGA no se hace responsable de decisiones tomadas solo con este resultado.'],
    ['Tu plano', 'Se usa solo para hacer el cómputo y se borra apenas termina: el archivo no se guarda. Mientras la herramienta está en ' +
      'prueba, guardamos por 30 días lo que viste en pantalla (lo que se leyó del plano y las cantidades) y un resumen técnico del archivo ' +
      '(capas y cantidad de objetos), solo para mejorar la lectura. Para reconocer los dibujos (planta, corte, fachada…) y leerlos mejor, ' +
      'una imagen de sus líneas y sus textos, no el archivo, se manda a un servicio externo (Anthropic). Subí solo planos que tengas ' +
      'derecho a usar.'],
    ['Tu acceso', 'El link es personal: no lo compartas. Dura 7 días desde que entrás, con hasta 40 cómputos por día.'],
    ['El resultado', 'Se ve en pantalla, con tu nombre de marca de agua. No se descarga ni se imprime. No está permitido copiarlo para ' +
      'revenderlo, ni intentar sacar de la herramienta sus fórmulas o sus precios.'],
    ['Cómo preparar el plano', 'Cada planta con su título (PLANTA BAJA, PLANTA ALTA), muros con doble línea y el nombre de cada local ' +
      'adentro. Si algo no se lee, la app te dice qué corregir en AutoCAD con las capas FUGA.'],
    ['Dudas', 'Escribinos por WhatsApp al +595 971 857 198.'],
  ];
  function textoReglas() {
    const caja = $('reglas-texto');
    caja.textContent = '';
    caja.append(el('ol', null, REGLAS.map(([t, d]) => el('li', null, el('strong', { text: t + '. ' }), d))));
  }
  function mostrarReglas() {
    textoReglas();
    $('reglas').hidden = false;
    $('carga').hidden = true;
    $('acepto').checked = reglasAceptadas;
    $('acepto').disabled = reglasAceptadas || aceptando;
    $('entrar').disabled = aceptando || !reglasAceptadas;
    $('entrar').textContent = reglasAceptadas ? 'Volver' : 'Entrar';
  }
  $('acepto').addEventListener('change', () => { $('entrar').disabled = aceptando || (!reglasAceptadas && !$('acepto').checked); });
  $('entrar').addEventListener('click', async () => {
    if (reglasAceptadas) {
      $('reglas').hidden = true;
      $('carga').hidden = false;
      return;
    }
    if (aceptando || !$('acepto').checked) return;
    aceptando = true;
    $('entrar').disabled = true;
    $('acepto').disabled = true;
    try {
      const r = await fetch('/api/aceptar', { method: 'POST', headers: { 'X-Link': token } });
      if (!r.ok) { const j = await r.json().catch(() => null); return mostrarError(j && j.error ? j.error.mensaje : 'No pude guardar que aceptaste las reglas. Recargá la página.', r.status === 410 || r.status === 401); }
      reglasAceptadas = true;
      $('reglas').hidden = true;
      $('carga').hidden = false;
    } catch (e) {
      mostrarError('Se cortó la conexión. Recargá la página.');
    } finally {
      aceptando = false;
      $('acepto').disabled = reglasAceptadas;
      $('entrar').disabled = !reglasAceptadas && !$('acepto').checked;
    }
  });
  $('ver-reglas').addEventListener('click', (e) => { e.preventDefault(); mostrarReglas(); window.scrollTo({ top: 0 }); });

  // ---------- sugerencias ----------
  // Van al servidor con el nombre del link (POST /api/sugerencia); nada del plano.
  let enviandoSugerencia = false;
  const textoSugerencia = () => $('sugerencia').value.trim();
  $('sugerencia').addEventListener('input', () => {
    $('enviar-sugerencia').disabled = enviandoSugerencia || !textoSugerencia();
    $('sugerencia-estado').textContent = '';
  });
  $('enviar-sugerencia').addEventListener('click', async () => {
    const texto = textoSugerencia();
    if (!texto || enviandoSugerencia) return;
    enviandoSugerencia = true;
    $('enviar-sugerencia').disabled = true;
    $('sugerencia-estado').textContent = 'Enviando…';
    try {
      const r = await fetch('/api/sugerencia', { method: 'POST', headers: { 'X-Link': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto }) });
      if (r.ok) {
        $('sugerencia').value = '';
        $('sugerencia-estado').textContent = '¡Gracias! La recibimos.';
      } else {
        const j = await r.json().catch(() => null);
        $('sugerencia-estado').textContent = (j && j.error && j.error.mensaje) || 'No pude enviarla. Probá de nuevo.';
      }
    } catch (e) {
      $('sugerencia-estado').textContent = 'Se cortó la conexión. Probá de nuevo.';
    } finally {
      enviandoSugerencia = false;
      $('enviar-sugerencia').disabled = !textoSugerencia();
    }
  });

  // ---------- acceso ----------
  async function estado() {
    try {
      const r = await fetch('/api/estado', { headers: { 'X-Link': token } });
      const j = await r.json();
      if (!r.ok) return mostrarError(j.error && j.error.mensaje, true);
      nombre = j.nombre;
      reglasAceptadas = !!j.aceptadas;
      const s = $('saludo');
      s.textContent = '';
      s.append('Hola, ', el('strong', { text: j.nombre }), `. Tu acceso vence el ${fecha(j.vence)}.`);
      // Aclaración de vigencia fuera del texto versionado: no exige volver a aceptar.
      s.append(el('span', { class: 'nota', text: ' El link dura hasta 7 días desde que se abre por primera vez y nunca más de 14 días desde que se generó.' }));
      marcaDeAgua();
      $('sugerencias').hidden = false;
      if (j.aceptadas) $('carga').hidden = false;
      else mostrarReglas();
    } catch (e) {
      $('saludo').textContent = 'No pude verificar tu acceso. Revisá la conexión y recargá la página.';
    }
  }

  // ---------- subida ----------
  // Un archivo que está solo en la nube (OneDrive, Google Drive) puede no dejarse leer, o tardar en bajar: se lee entero antes de subirlo
  // para avisar eso, en lugar de un «se cortó la conexión» que no dice nada.
  const NUBE = 'No pude leer el archivo desde tu compu. Si está en OneDrive o Google Drive, puede que esté solo en la nube: abrilo una vez ' +
    'en AutoCAD, o en el Explorador hacé clic derecho → «Mantener siempre en este dispositivo», y subilo de nuevo.';
  const LEER_SEGUNDOS = 90;

  function leerArchivo(archivo) {
    return Promise.race([
      archivo.arrayBuffer(),
      new Promise((_, mal) => setTimeout(() => mal(new Error('tiempo')), LEER_SEGUNDOS * 1000)),
    ]);
  }

  async function subir(archivo) {
    if (!archivo) return;
    if (!/\.(dwg|dxf)$/i.test(archivo.name)) return mostrarError('Subí un archivo DWG o DXF.');
    if (archivo.size > 60 * 1024 * 1024) return mostrarError('El archivo pasa de 60 MB. Sacá lo que no sea de la obra o subí un DXF.');
    $('error').hidden = true;
    $('resultado').hidden = true;
    $('supuestos').hidden = true; // supuestos
    $('carga').hidden = true;
    $('progreso').hidden = false;
    const barra = $('barra');
    const texto = $('progreso-texto');
    barra.parentElement.classList.remove('computando');
    barra.style.width = '0';
    texto.textContent = 'Leyendo el archivo de tu compu…';
    let datos;
    try {
      datos = await leerArchivo(archivo);
    } catch (e) {
      $('progreso').hidden = true;
      $('carga').hidden = false;
      return mostrarError(NUBE);
    }
    if (!datos.byteLength) {
      $('progreso').hidden = true;
      $('carga').hidden = false;
      return mostrarError(NUBE);
    }
    texto.textContent = 'Subiendo el plano…';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/computar');
    xhr.setRequestHeader('X-Link', token);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    const unidad = $('unidad').value;
    if (unidad) xhr.setRequestHeader('X-Unidad', unidad);
    let reloj = null;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) barra.style.width = Math.round((e.loaded / e.total) * 100) + '%'; };
    xhr.upload.onload = () => {
      barra.parentElement.classList.add('computando');
      const t0 = Date.now();
      const paso = () => {
        const s = Math.round((Date.now() - t0) / 1000);
        texto.textContent = `Leyendo las láminas y midiendo… ${s} s` + (s > 20 ? ' (un plano grande tarda hasta un par de minutos)' : '');
      };
      paso();
      reloj = setInterval(paso, 1000);
    };
    xhr.onload = () => {
      clearInterval(reloj);
      let j = null;
      try { j = JSON.parse(xhr.responseText); } catch (e) { /* respuesta rara */ }
      $('progreso').hidden = true;
      $('carga').hidden = false;
      if (!j) return mostrarError('El servidor no respondió bien. Probá de nuevo.');
      if (j.error) return mostrarError(j.error.mensaje, xhr.status === 410 || xhr.status === 401);
      computo = xhr.getResponseHeader('X-Computo') || null; enviados = '{}'; // supuestos
      mostrar(j, archivo.name);
    };
    xhr.onerror = () => {
      clearInterval(reloj);
      $('progreso').hidden = true;
      $('carga').hidden = false;
      mostrarError('Se cortó la conexión. Probá de nuevo.');
    };
    xhr.send(datos);
  }

  function mostrarError(mensaje, sinAcceso) {
    const caja = $('error');
    caja.textContent = '';
    caja.append(el('p', { text: mensaje || 'Algo falló. Probá de nuevo.' }));
    if (sinAcceso) {
      $('carga').hidden = true;
      caja.append(el('a', { class: 'boton', href: 'https://wa.me/595971857198?text=Hola%20FUGA%2C%20vengo%20del%20c%C3%B3mputo', text: 'Escribinos' }));
    }
    caja.hidden = false;
  }

  // ---------- resultado ----------
  function mostrar(v, archivo) {
    // sin ninguna planta no hay cómputo: se dice qué pasó y qué se vio, en lugar de un total en cero
    if (!v.sectores.length) {
      $('supuestos').hidden = true; // supuestos
      mostrarError(`No encontré ninguna planta de arquitectura en ${archivo}. Cada planta tiene que tener su título (PLANTA BAJA, ` +
        'PLANTA ALTA…) y los muros dibujados como dos líneas paralelas. Corregilo en AutoCAD y volvé a subir el archivo.');
      if (v.noUsados.length) {
        $('error').append(el('details', null, el('summary', { text: `Lo que vi en el archivo (${v.noUsados.length} dibujos)` }),
          el('ul', null, v.noUsados.map((n) => el('li', { text: `${n.titulo || 'Sin título'}: ${n.motivo}` })))));
      }
      return;
    }
    const medidas = v.sectores.flatMap((s) => s.medidas.map((m) => ({ ...m, sector: s.nombre })));
    const cuenta = { ok: 0, duda: 0, falta: 0 };
    for (const m of medidas) cuenta[estadoDe(m.valor, m.falta)]++;
    const varios = v.sectores.length > 1;

    // resumen: con rubros en falta, el total es una suma parcial y se dice cuántos rubros entran
    const renglones = v.sectores.flatMap((s) => s.renglones);
    const conTotal = renglones.filter((r) => r.total != null).length;
    const res = $('resumen');
    res.textContent = '';
    const pct = (k) => (medidas.length ? (cuenta[k] / medidas.length) * 100 : 0) + '%';
    const medidor = el('div', { class: 'medidor', role: 'img',
      'aria-label': `${cuenta.ok} medidas listas, ${cuenta.duda} a confirmar y ${cuenta.falta} que faltan` });
    for (const [k, c] of [['ok', 'm-ok'], ['duda', 'm-duda'], ['falta', 'm-falta']]) {
      const i = el('i', { class: c });
      i.style.width = pct(k);
      medidor.append(i);
    }
    res.append(
      el('div', null,
        el('p', { class: 'etiqueta-chica', text: v.incompleto ? `Suma parcial · ${conTotal} de ${renglones.length} rubros` : 'Costo directo' }),
        el('p', { class: 'total' }, el('small', { text: 'Gs.' }), gs(v.total)),
        el('p', { class: 'detalle-total', text: (v.incompleto
          ? 'Suma solo los rubros que se pudieron medir. Los que tienen una falta no entran al total hasta que se corrija el plano.'
          : 'Precios de la Revista COSTOS #373, sin coeficiente de ajuste ni tu margen.') + ` Plano: ${archivo}.` })),
      el('div', null,
        el('p', { class: 'etiqueta-chica', text: 'Medidas del panel' }),
        el('p', { class: 'conteo' }, String(cuenta.ok), el('span', { text: ` de ${medidas.length} listas` })),
        medidor,
        el('p', { class: 'leyenda' },
          el('span', null, el('b', { class: 'estado ok' }), `${cuenta.ok} listas`),
          el('span', null, el('b', { class: 'estado duda' }), `${cuenta.duda} a confirmar`),
          el('span', null, el('b', { class: 'estado falta' }), `${cuenta.falta} faltan`))));

    // qué corregir: cada motivo una sola vez, numerado, con lo que afecta; las tablas lo nombran por su número
    const motivos = new Map();
    const anotar = (falta, afecta) => {
      if (!falta) return [];
      return [...new Set(String(falta).split('; ').map((x) => x.trim()).filter(Boolean))].map((t) => {
        if (!motivos.has(t)) motivos.set(t, { n: motivos.size + 1, afecta: [] });
        const m = motivos.get(t);
        if (afecta && !m.afecta.includes(afecta)) m.afecta.push(afecta);
        return m.n;
      });
    };
    for (const s of v.sectores) {
      for (const m of s.medidas) m.nros = anotar(m.falta, `${varios ? s.nombre + ' · ' : ''}${m.grupo} · ${m.nombre}`);
      for (const r of s.renglones) r.nros = anotar(r.falta, null);
    }
    const faltas = $('faltas');
    faltas.textContent = '';
    if (motivos.size) {
      faltas.append(el('section', { class: 'faltas' },
        el('h2', { text: motivos.size === 1 ? 'Una cosa para corregir' : `${motivos.size} cosas para corregir` }),
        el('p', { class: 'detalle-total', text: 'Corregilas en AutoCAD y volvé a subir el archivo. En la app no se dibuja ni se edita nada.' }),
        el('ol', null, [...motivos].map(([texto, m]) => el('li', { id: 'motivo-' + m.n }, el('div', null,
          el('span', { class: 'que', text: texto.charAt(0).toUpperCase() + texto.slice(1) }),
          m.afecta.length ? el('span', { class: 'por', text: 'Afecta: ' + m.afecta.join(', ') }) : null))))));
    }
    faltas.append(guia(motivos.size > 0));

    // cada sector: panel y planilla
    const cont = $('sectores');
    cont.textContent = '';
    for (const s of v.sectores) cont.append(sector(s, varios));

    // lo que no se usó y los avisos
    const extras = $('extras');
    extras.textContent = '';
    if (v.noUsados.length) {
      extras.append(el('details', null, el('summary', { text: `Dibujos que no se usaron (${v.noUsados.length})` }),
        el('ul', null, v.noUsados.map((n) => el('li', { text: `${n.titulo || 'Sin título'}: ${n.motivo}` })))));
    }
    if (v.avisos.length) {
      extras.append(el('details', null, el('summary', { text: `Avisos de la lectura (${v.avisos.length})` }),
        el('ul', null, v.avisos.map((a) => el('li', { text: a })))));
    }
    extras.append(el('div', { class: 'acciones' },
      el('button', { class: 'boton secundario', type: 'button', id: 'otro', text: 'Subir otro plano' })));
    $('otro').addEventListener('click', () => { window.scrollTo({ top: 0 }); $('archivo').click(); });

    $('resultado').hidden = false;
    $('resultado').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    mostrarSupuestos(v, archivo); // supuestos
  }

  // ---------- dibujo de lo leído (SVG armado con nodos; en metros, con la y para arriba) ----------
  const SVG = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
    return n;
  }
  const camino = (lineas) => lineas.map(([a, b]) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`).join('');
  const poligono = (pts) => 'M' + pts.map((p) => `${p[0]} ${p[1]}`).join('L') + 'Z';
  function dibujoPlanta(l) {
    const todos = [].concat(...l.muros.map((m) => [m[0], m[1]]), ...l.contornos, ...l.fondo.map((s) => [s[0], s[1]]));
    if (!todos.length) return el('p', { class: 'detalle-total', text: 'No hay nada que dibujar en esta planta.' });
    const xs = todos.map((p) => p[0]), ys = todos.map((p) => p[1]);
    const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
    const w = x1 - x0, h = y1 - y0, radio = Math.max(w, h) / 120;
    const raiz = svg('svg', { viewBox: `${x0} ${-y1} ${w} ${h}`, role: 'img', 'aria-label': 'Lo que leí de esta planta' });
    const g = svg('g', { transform: 'scale(1,-1)' });
    raiz.append(g);
    if (l.fondo.length) g.append(svg('path', { d: camino(l.fondo), class: 'd-fondo' }));
    l.contornos.forEach((c) => g.append(svg('path', { d: poligono(c), class: 'd-contorno' })));
    l.locales.forEach((c) => g.append(svg('path', { d: poligono(c), class: 'd-local' })));
    l.muros.forEach(([a, b, esp]) => g.append(svg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], 'stroke-width': esp || 0.15, class: 'd-muro' })));
    l.aberturas.forEach(([a, b, tipo]) => g.append(svg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], 'stroke-width': radio,
      class: tipo === 'ventana' ? 'd-ventana' : 'd-puerta' })));
    l.sueltas.forEach((p) => g.append(svg('circle', { cx: p[0], cy: p[1], r: radio, class: 'd-suelta' })));
    return raiz;
  }
  function capasUsadas(f) {
    const usadas = [['muros', 'FUGA-MURO'], ['contorno', 'FUGA-CONTORNO'], ['aberturas', 'FUGA-PUERTA / VENTANA'], ['locales', 'FUGA-LOCAL']]
      .filter(([k]) => f && f[k]).map(([, n]) => n);
    return usadas.length ? ` · con ${usadas.join(', ')}` : '';
  }

  // ---------- guía de capas FUGA ----------
  const CAPAS = [
    ['FUGA-CONTORNO', 'Una polilínea cerrada por la cara exterior de la casa (una por cuerpo).', 'La superficie, y qué muros y puertas son exteriores.'],
    ['FUGA-MURO-20 · FUGA-MURO-15', 'Una línea por el eje de cada muro, de esquina a esquina, sin cortarla en puertas ni ventanas.', 'Los ml de muro. Con esta capa se usan solo esos muros.'],
    ['FUGA-PUERTA · FUGA-VENTANA', 'Una línea atravesando cada abertura, del largo de su ancho.', 'Puertas y ventanas. Con estas capas se usan solo esas.'],
    ['FUGA-LOCAL', 'Una polilínea cerrada por la cara interior de un baño o una cocina que no cierra solo.', 'Los azulejos de ese local.'],
    ['FUGA-TECHO', 'Una polilínea cerrada por el borde del alero, y adentro, en la misma capa, el texto CHAPA PEND 15 %, TEJA PEND 30 % o LOSA. Un patio abierto: otra polilínea cerrada adentro.', 'El techo, sin planta de techos. Con chapa o teja, también el cimiento de PBC.'],
    ['FUGA-DATO', 'Textos sueltos: ALTURA 2,80 · ALTURA PA 2,60 · FUNDACION PBC · FUNDACION ZAPATAS · ZAPATAS 12 · BOCAS 25 · DESAGUE 30 ML · REGISTROS 4 · AGUA 25 ML.', 'Lo que el plano no dibuja (cortes, fundaciones, instalaciones).'],
    ['FUGA-EXCLUIR', 'Lo que no es de la obra: el lote vecino, autos, muebles, una muralla.', 'Que no se computa.'],
  ];
  function guia(abierta) {
    const d = el('details', { class: 'guia' });
    if (abierta) d.setAttribute('open', '');
    d.append(el('summary', { text: 'Cómo corregir el plano en AutoCAD: capas FUGA' }),
      el('p', { class: 'detalle-total', text: 'Lo que pongas en estas capas manda sobre lo que la app detecta sola. Escribí el nombre de la capa ' +
        'tal cual, en cualquier color, y apagale el plot si no querés que salga impreso en el plano.' }),
      el('p', { class: 'bajar' },
        el('a', { class: 'boton secundario', href: '/computo/recursos/capas-fuga.lsp', download: 'capas-fuga.lsp', text: 'Bajar el comando FUGACAPAS' }),
        el('span', { class: 'detalle-total', text: ' Crea las 9 capas de una vez, con su color y sin imprimirse. Arrastrá el archivo a ' +
          'AutoCAD (o cargalo con APPLOAD) y escribí FUGACAPAS. No borra ni cambia nada de tu dibujo.' })),
      el('div', { class: 'tabla' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { text: 'Capa' }), el('th', { text: 'Qué dibujar' }), el('th', { text: 'Qué resuelve' }))),
        el('tbody', null, CAPAS.map(([c, q, r]) => el('tr', null, el('td', { class: 'capa', text: c }), el('td', { text: q }), el('td', { text: r })))))));
    return d;
  }

  // «ver 01, 03»: enlaces a los motivos de la lista de correcciones
  function ref(nros) {
    if (!nros || !nros.length) return null;
    const span = el('span', { class: 'motivo' }, 'ver ');
    nros.forEach((n, i) => span.append(i ? ', ' : '', el('a', { href: '#motivo-' + n, text: String(n).padStart(2, '0') })));
    return span;
  }

  function sector(s, varios) {
    const sec = el('section', { class: 'sector' });
    sec.append(el('div', { class: 'sector-cabeza' },
      el('h2', { text: varios ? `Sector ${s.nombre}` : 'Tu obra' }),
      el('p', { class: 'subtotal' }, `Gs. ${gs(s.subtotal)}`, s.incompleto ? ' ' : '', s.incompleto ? etiqueta('duda') : null)));

    // lo que se leyó de cada planta
    if (s.plantas && s.plantas.length) {
      sec.append(el('div', { class: 'bloque' }, el('h3', { text: 'Lo que leí del plano' }),
        el('p', { class: 'detalle-total', text: 'Los trazos gruesos son los muros que reconocí; en azul, la casa; en verde, puertas y ventanas; en rojo, ' +
          'puntas de muro sueltas (ahí la planta no cierra). Si algo no coincide con tu plano, corregilo con las capas FUGA.' }),
        s.plantas.map((p) => el('figure', { class: 'dibujo' }, dibujoPlanta(p.leido), el('figcaption', null, p.nivel,
          capasUsadas(p.leido.fuga))))));
    }

    // panel de medidas
    const filas = [];
    let grupo = null;
    for (const m of s.medidas) {
      if (m.grupo !== grupo) { grupo = m.grupo; filas.push(el('tr', { class: 'grupo' }, el('td', { colspan: '5', class: 'grupo', text: grupo }))); }
      const e = estadoDe(m.valor, m.falta);
      filas.push(el('tr', null,
        el('td', null, m.nombre, ref(m.nros)),
        el('td', { class: 'num' + (e === 'duda' ? ' parcial' : ''), text: cant(m.valor) }),
        el('td', { text: m.unidad || '' }),
        el('td', { class: 'lam', text: m.lamina || '—' }),
        el('td', null, etiqueta(e))));
    }
    sec.append(el('div', { class: 'bloque' }, el('h3', { text: 'Panel de medidas' }), el('div', { class: 'tabla' },
      el('table', null,
        el('thead', null, el('tr', null, el('th', { text: 'Medida' }), el('th', { class: 'num', text: 'Valor' }), el('th', { text: 'Un.' }),
          el('th', { text: 'Lámina' }), el('th', { text: 'Estado' }))),
        el('tbody', null, filas)))));

    // planilla de rubros
    const renglones = s.renglones.map((r) => {
      const e = estadoDe(r.cantidad != null ? r.cantidad : r.parcial, r.falta);
      return el('tr', null,
        el('td', { class: 'num', text: String(r.item) }),
        el('td', null, r.rubro, ref(r.nros)),
        el('td', { text: r.unidad || '' }),
        el('td', { class: 'num' + (r.cantidad == null && r.parcial != null ? ' parcial' : ''),
          text: r.cantidad != null ? cant(r.cantidad) : r.parcial != null ? `${cant(r.parcial)} (parcial)` : '—' }),
        el('td', { class: 'num', text: gs(r.pu) }),
        el('td', { class: 'num', text: gs(r.total) }),
        el('td', null, etiqueta(e)));
    });
    sec.append(el('div', { class: 'bloque' }, el('h3', { text: 'Planilla de rubros' }), el('div', { class: 'tabla' },
      el('table', null,
        el('thead', null, el('tr', null, el('th', { class: 'num', text: 'Ítem' }), el('th', { text: 'Rubro' }), el('th', { text: 'Un.' }),
          el('th', { class: 'num', text: 'Cantidad' }), el('th', { class: 'num', text: 'P. unit. Gs.' }), el('th', { class: 'num', text: 'Total Gs.' }),
          el('th', { text: 'Estado' }))),
        el('tbody', null, renglones),
        el('tfoot', null, el('tr', null, el('td', { colspan: '5', text: s.incompleto ? 'Subtotal (sin los rubros en falta)' : 'Subtotal' }),
          el('td', { class: 'num', text: gs(s.subtotal) }), el('td')))))));

    if (s.avisos.length) {
      sec.append(el('details', null, el('summary', { text: `Cómo se midió (${s.avisos.length} notas)` }),
        el('ul', null, s.avisos.map((a) => el('li', { text: a })))));
    }
    return sec;
  }

  // ---------- supuestos ----------
  // Lo que el plano no dice y la herramienta supone (el relleno, la altura de los muros de cada planta, el cielorraso bajo la chapa, la
  // silleta): viene del servidor en cada sector (sectores[i].supuestos), con su valor y de dónde sale. La persona lo cambia y toca
  // «Recalcular»: el servidor rehace los rubros sobre lo que ya leyó del plano (POST /api/recalcular, con el id que mandó en X-Computo),
  // sin volver a subirlo. Acá tampoco se calcula nada: la página manda lo que cambió la persona y muestra la vista que vuelve.
  // Un campo de número vacío quiere decir «lo del plano»: lo que se midió por el dibujo no se confirma solo (queda de ejemplo, gris). Un
  // campo que la persona no tocó (el mismo texto con que arrancó) queda como estaba: ni se valida ni se manda (revisión del 29/10/2026: una
  // altura del plano con más decimales, «2,6967», arranca en «2,7», y una de FUGA-DATO puede quedar fuera de 2,20–6,00).
  let computo = null;       // el id del cómputo en el servidor (X-Computo), o null si no se puede recalcular
  let archivoSup = '';      // el nombre del plano, para mostrar()
  let filasSup = [];        // [{sector, d, campo, mal, inicial}]
  let enviados = '{}';      // el pedido que dio el resultado que se ve ('{}' recién subido)
  let totalVisto = 0;
  let recalculando = false;
  let ultimoCampo = null;   // el id del último campo que tocó la persona: después de recalcular vuelve a tener el foco
  const ESTADO_SUP = { plano: ['ok', 'Medido del plano'], dibujo: ['duda', 'Del dibujo, a confirmar'], falta: ['falta', 'Falta'],
    supuesto: ['gris', 'Supuesto'] };

  function mostrarSupuestos(v, archivo) {
    archivoSup = archivo;
    totalVisto = v.total;
    filasSup = [];
    const lista = $('supuestos-lista');
    lista.textContent = '';
    const varios = v.sectores.length > 1;
    for (const s of v.sectores) {
      const ds = Array.isArray(s.supuestos) ? s.supuestos : [];
      if (!ds.length) continue;
      if (varios) lista.append(el('h3', { text: `Sector ${s.nombre}` }));
      for (const d of ds) lista.append(filaSupuesto(s.nombre, d, s.renglones));
    }
    marcarSupuestas(v);
    $('supuestos').hidden = !filasSup.length;
    $('supuestos-estado').textContent = computo ? '' : 'Para cambiar los supuestos de este plano, volvé a subirlo.';
    actualizarBoton();
  }

  // Las medidas que salen de un supuesto que eligió la persona (medidas[i].supuesto, 30/10/2026: la altura de una planta y los pilares
  // rehechos con ella) dicen «Supuesto» en el panel de su sector, no «Medido». El panel lo arma mostrar() con una fila por medida, en
  // el orden de s.medidas, más las filas de grupo: acá solo se cambia la etiqueta de las que vienen sin falta.
  function marcarSupuestas(v) {
    Array.from($('sectores').children).filter((n) => n && typeof n.querySelectorAll === 'function').forEach((sec, i) => {
      const s = v.sectores[i];
      if (!s || !s.medidas.some((m) => m.supuesto && !m.falta)) return;
      const bloque = Array.from(sec.querySelectorAll('div')).find((x) => x.className === 'bloque' && x.querySelector('h3') &&
        x.querySelector('h3').textContent === 'Panel de medidas');
      const cuerpo = bloque && bloque.querySelector('tbody');
      if (!cuerpo) return;
      const trs = Array.from(cuerpo.querySelectorAll('tr')).filter((tr) => tr.className !== 'grupo');
      s.medidas.forEach((m, j) => {
        if (!m.supuesto || m.falta || !trs[j]) return;
        const tds = trs[j].querySelectorAll('td');
        const etiq = tds.length ? tds[tds.length - 1].querySelector('span') : null;
        if (etiq) { etiq.className = 'estado gris'; etiq.textContent = 'Supuesto'; }
      });
    });
  }

  // Con un supuesto cambiado, los rubros que lo usan y siguen en falta por otra causa (renglones[i].supuestos y motivo, del servidor):
  // la fila lo dice, con el número de esa causa en «cosas para corregir» (Alex, 30/10/2026: puso la altura y «no corrigió nada»)
  const minuscula = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  const enLista = (xs) => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1] : xs.join(''));
  function siguenEnFalta(d, renglones) {
    if (!d.cambiado) return null;
    const quedan = (Array.isArray(renglones) ? renglones : []).filter((r) => r.motivo && Array.isArray(r.supuestos) && r.supuestos.includes(d.clave));
    if (!quedan.length) return null;
    const nros = [...new Set(quedan.flatMap((r) => r.nros || []))].sort((a, b) => a - b);
    return el('p', { class: 'supuesto-ayuda' },
      `Con ${/^altura\./.test(d.clave) ? 'esta altura' : 'lo que elegiste'} siguen en falta, por otra causa: ` +
      enLista(quedan.map((r) => minuscula(r.rubro))) + '.', ref(nros));
  }

  function filaSupuesto(sector, d, renglones) {
    const id = 'sup-' + filasSup.length;
    let campo;
    if (d.tipo === 'opcion') {
      campo = el('select', { id }, d.opciones.map((o) => el('option', { value: o.valor, text: o.texto })));
      campo.value = d.valor;
    } else {
      const deBase = (d.base.fuente === 'plano' || d.base.fuente === 'supuesto') && d.base.valor != null;
      campo = el('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': id + '-mal',
        placeholder: d.base.fuente === 'dibujo' && d.base.valor != null ? cant(d.base.valor) : null });
      campo.value = d.cambiado ? cant(d.valor) : deBase ? cant(d.base.valor) : '';
      // Enter recalcula, como en un formulario (si hay algo para mandar)
      campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); recalcularAhora(); } });
    }
    const [clase, texto] = d.cambiado ? ['tuyo', 'Cambiado por vos'] : ESTADO_SUP[d.base.fuente] || ESTADO_SUP.supuesto;
    const mal = el('p', { class: 'supuesto-mal', id: id + '-mal' });
    mal.hidden = true;
    campo.addEventListener(d.tipo === 'opcion' ? 'change' : 'input', () => { ultimoCampo = id; actualizarBoton(); });
    filasSup.push({ sector, d, campo, mal, inicial: campo.value });
    return el('div', { class: 'supuesto-fila' },
      el('label', { for: id, text: d.texto }),
      el('span', { class: 'supuesto-control' }, campo, d.unidad ? el('span', { text: d.unidad }) : null),
      el('span', { class: 'estado ' + clase, text: texto }),
      d.cambiado && d.base.texto ? el('p', { class: 'supuesto-ayuda', text: d.base.texto }) : null,
      d.ayuda ? el('p', { class: 'supuesto-ayuda', text: d.ayuda }) : null,
      siguenEnFalta(d, renglones),
      mal);
  }

  // un campo: {valor} | {vacio} | {mal}. El número se escribe con coma o con punto y va redondeado a su paso, como lo guarda el servidor
  // (20,0000001 cm es 20). Sin tocar, lo de antes: lo elegido, o nada. Lo del plano vale siempre, tal cual (como en el servidor)
  function leerCampo(f) {
    if (f.d.tipo === 'opcion') return { valor: f.campo.value };
    if (f.campo.value === f.inicial) return f.d.cambiado ? { valor: f.d.valor } : { vacio: true };
    const t = String(f.campo.value).replace(/\s/g, '').replace(',', '.');
    if (!t) return { vacio: true };
    if (!/^\d+(\.\d+)?$/.test(t)) return { mal: true };
    const v = Number(t), pasos = v / f.d.paso;
    if (v === f.d.base.valor) return { valor: v };
    if (v < f.d.min - 1e-9 || v > f.d.max + 1e-9 || Math.abs(pasos - Math.round(pasos)) > 1e-6) return { mal: true };
    return { valor: f.d.paso >= 1 ? Math.round(pasos) * f.d.paso : Math.round(v * 100) / 100 };
  }

  // lo que cambió la persona, {sector: {clave: valor}} en el orden de las filas: un número escrito si la base no es del plano (por el
  // dibujo o en falta) o si es otro; una opción si es otra
  function pedidoActual() {
    const pedido = {};
    let mal = false;
    for (const f of filasSup) {
      const x = leerCampo(f);
      f.mal.hidden = !x.mal;
      f.mal.textContent = x.mal ? `Escribí ${f.d.rango}.` : '';
      if (f.d.tipo !== 'opcion') f.campo.setAttribute('aria-invalid', x.mal ? 'true' : 'false');
      if (x.mal) { mal = true; continue; }
      if (x.vacio) continue;
      const manda = f.d.tipo === 'opcion' ? x.valor !== f.d.base.valor
        : f.d.base.fuente === 'dibujo' || f.d.base.fuente === 'falta' || f.d.base.valor == null || Math.abs(x.valor - f.d.base.valor) > 1e-9;
      if (!manda) continue;
      if (!pedido[f.sector]) pedido[f.sector] = {};
      pedido[f.sector][f.d.clave] = x.valor;
    }
    return { pedido, mal };
  }

  function actualizarBoton() {
    const { pedido, mal } = pedidoActual();
    $('recalcular').disabled = !computo || recalculando || mal || JSON.stringify(pedido) === enviados;
  }

  // los desplegables del resultado que la persona abrió o cerró: mostrar() rearma todo, y después de recalcular quedan como estaban. Cada
  // uno se reconoce por el texto de su título sin los números («Cómo se midió (# notas)») y su orden entre los que se llaman igual
  function desplegables() {
    const vistos = new Map();
    return [...$('resultado').querySelectorAll('details')].map((d) => {
      const s = d.querySelector('summary');
      const titulo = s ? s.textContent.replace(/\d+/g, '#') : '';
      const n = vistos.get(titulo) || 0;
      vistos.set(titulo, n + 1);
      return { clave: titulo + '\n' + n, d };
    });
  }
  const abiertos = () => new Map(desplegables().map((x) => [x.clave, !!x.d.open]));
  function reabrir(antes) { for (const x of desplegables()) if (antes.has(x.clave)) x.d.open = antes.get(x.clave); }

  // con el botón o con Enter en un campo
  async function recalcularAhora() {
    const { pedido, mal } = pedidoActual();
    const cuerpo = JSON.stringify(pedido);
    if (!computo || recalculando || mal || cuerpo === enviados) return;
    const id = computo, antes = totalVisto;
    const linea = $('supuestos-estado');
    const otro = () => id !== computo || $('supuestos').hidden;   // mientras tanto se subió otro plano: la respuesta no sirve
    recalculando = true;
    actualizarBoton();
    linea.textContent = 'Recalculando…';
    try {
      const r = await fetch('/api/recalcular', { method: 'POST', headers: { 'X-Link': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ computo: id, supuestos: pedido }) });
      const j = await r.json().catch(() => null);
      if (otro()) return;
      if (!j) { linea.textContent = 'El servidor no respondió bien. Probá de nuevo.'; return; }
      if (j.error) {
        if (['no_existe', 'revocado', 'vencido'].includes(j.error.codigo)) {
          computo = null;
          // el aviso con «Escribinos» queda arriba, como en las otras rutas; acá se ve el mismo mensaje, donde la persona tocó
          linea.textContent = j.error.mensaje || '';
          mostrarError(j.error.mensaje, true);
          return;
        }
        if (j.error.codigo === 'computo') computo = null;
        linea.textContent = j.error.mensaje || 'El servidor no respondió bien. Probá de nuevo.';
        return;
      }
      computo = r.headers.get('X-Computo') || computo;
      enviados = cuerpo;
      const antesAbiertos = abiertos();
      mostrar(j, archivoSup);
      reabrir(antesAbiertos);
      // sin animación: corta el desplazamiento de mostrar() y deja a la persona en los controles, para seguir probando
      $('recalcular').scrollIntoView({ block: 'center' });
      // si el total no se movió porque lo que usa el cambio sigue en falta por otra causa, se dice (cada supuesto dice cuáles)
      const quieto = j.total === antes && j.sectores.some((s) => s.renglones.some((r) => r.motivo));
      linea.textContent = !Object.keys(pedido).length ? `Volvió a los valores iniciales: Gs. ${gs(j.total)}.`
        : quieto ? `Recalculado: el total sigue en Gs. ${gs(j.total)}. Lo que cambiaste se usa en rubros que siguen en falta por otra causa.`
          : `Recalculado: Gs. ${gs(j.total)} (antes Gs. ${gs(antes)}).`;
      // mostrar() rearmó los campos: el foco vuelve al que tocó la persona (si no, queda en la página entera)
      const f = filasSup.find((x) => x.campo.id === ultimoCampo);
      if (f && typeof f.campo.focus === 'function') f.campo.focus({ preventScroll: true });
    } catch (e) {
      if (!otro()) linea.textContent = 'Se cortó la conexión. Probá de nuevo.';
    } finally {
      recalculando = false;
      actualizarBoton();
    }
  }
  $('recalcular').addEventListener('click', recalcularAhora);
  // ---------- fin supuestos ----------

  // ---------- eventos ----------
  const input = $('archivo');
  input.addEventListener('change', () => { subir(input.files[0]); input.value = ''; });
  const zona = $('zona');
  zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('encima'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
  zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('encima'); subir(e.dataTransfer.files[0]); });
  zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  zona.setAttribute('tabindex', '0');
  zona.setAttribute('role', 'button');

  // el resultado se ve, no se copia
  const res = $('resultado');
  for (const ev of ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart']) res.addEventListener(ev, (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['p', 's'].includes(e.key.toLowerCase())) e.preventDefault();
  });

  estado();
})();
