// Acceso a la demo «Cómputo desde plano»: valida el código del link personal y calcula el vencimiento.
// Código = base64url(JSON {n:nombre, g:"AAAA-MM-DD"}) + "." + firma (12 hex de SHA-256(payload + "|" + SAL)).
// Debe coincidir byte a byte con computo/generar_link.py (misma SAL, mismo JSON compacto en UTF-8).
(function(root){
  'use strict';
  var SAL = 'fuga-computo-demo-2026';
  var DIA = 24*60*60*1000;
  var VIGENCIA_DIAS = 7;     // desde la primera apertura
  var TOPE_DIAS = 14;        // desde la fecha de generación, aunque se abra tarde
  var PREFIJO = 'fuga:web-computo:';

  function aBase64url(bytes){
    var s = ''; for (var i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function deBase64url(t){
    var b = t.replace(/-/g,'+').replace(/_/g,'/'); while (b.length % 4) b += '=';
    var s = atob(b), bytes = new Uint8Array(s.length);
    for (var i=0;i<s.length;i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }
  async function firmar(payload){
    var h = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload + '|' + SAL));
    var hex = ''; new Uint8Array(h).forEach(function(b){ hex += (b < 16 ? '0' : '') + b.toString(16); });
    return hex.slice(0, 12);
  }

  // → {nombre, generado:Date (medianoche de Paraguay), firma} o null si el formato o la firma no valen.
  async function leerCodigo(c){
    try {
      if (typeof c !== 'string') return null;
      var p = c.split('.');
      if (p.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(p[0]) || !/^[0-9a-f]{12}$/.test(p[1])) return null;
      if (await firmar(p[0]) !== p[1]) return null;
      var d = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(deBase64url(p[0])));
      if (!d || typeof d.n !== 'string' || !d.n || typeof d.g !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.g)) return null;
      var generado = new Date(d.g + 'T00:00:00-03:00');
      if (isNaN(generado.getTime())) return null;
      return {nombre:d.n, generado:generado, firma:p[1]};
    } catch (e) { return null; }
  }

  // Estado de acceso. almacen = {get(k), set(k,v)}; si falla o falta se trata como vacío (primera = ahora).
  // Vence en min(primera + 7 días, generado + 14 días).
  function estado(codigo, ahora, almacen){
    if (!codigo) return {modo:'ejemplo'};
    var tope = codigo.generado.getTime() + TOPE_DIAS*DIA, t = ahora.getTime();
    var clave = PREFIJO + codigo.firma, primera = NaN;
    try { var v = almacen && almacen.get(clave); if (v) primera = new Date(v).getTime(); } catch (e) {}
    if (isNaN(primera)) {
      if (t >= tope) return {modo:'vencido', nombre:codigo.nombre};   // pasó el tope: no se guarda nada
      primera = t;
      try { if (almacen) almacen.set(clave, ahora.toISOString()); } catch (e) {}
    }
    var vence = Math.min(primera + VIGENCIA_DIAS*DIA, tope);
    if (t >= vence) return {modo:'vencido', nombre:codigo.nombre};
    return {modo:'activo', nombre:codigo.nombre, diasRestantes:Math.max(1, Math.ceil((vence - t)/DIA))};
  }

  var api = {leerCodigo:leerCodigo, estado:estado};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FugaAcceso = api;
})(typeof window === 'undefined' ? globalThis : window);
