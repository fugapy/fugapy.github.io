// Cámara y micrófono. Todo funciona sin señal: no se manda nada a ningún lado.

import * as db from './db.js';
import { uuid, ahoraISO } from './modelo.js';

// --- Cámara -------------------------------------------------------------------

export async function abrirCamara(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } },
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  return stream;
}

export function cerrarStream(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

// Foto a la máxima resolución que dé el celular; si no se puede, cuadro del video.
export async function sacarFoto(stream, video) {
  const pista = stream?.getVideoTracks()[0];
  if (pista && 'ImageCapture' in window) {
    try {
      const blob = await new ImageCapture(pista).takePhoto();
      if (blob?.size) return blob;
    } catch { /* algunos celulares no lo soportan: seguimos con el cuadro */ }
  }
  const lienzo = document.createElement('canvas');
  lienzo.width = video.videoWidth;
  lienzo.height = video.videoHeight;
  lienzo.getContext('2d').drawImage(video, 0, 0);
  return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('No salió la foto'))), 'image/jpeg', 0.92));
}

// --- Audio --------------------------------------------------------------------

export function mimeAudio() {
  if (!window.MediaRecorder) return null;
  const op = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
  return op.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

async function microfono() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
}

// Grabación larga de la charla. Una sola a la vez, sigue mientras se navega.
class Grabador {
  constructor() {
    this.estado = 'quieto'; // quieto | grabando | pausa
    this.obra = null;
    this.g = null;
    this.alCambiar = () => {};
    this.alGuardar = () => {};
  }

  segundos() {
    if (!this.g) return 0;
    const corriendo = this.estado === 'grabando' ? (performance.now() - this.desde) / 1000 : 0;
    return this.acumulado + corriendo;
  }

  async empezar(obra, quien) {
    if (this.estado !== 'quieto') return;
    const mime = mimeAudio();
    if (mime === null) throw new Error('Este navegador no puede grabar audio');
    this.stream = await microfono();
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
    this.obra = obra;
    this.g = {
      id: uuid(),
      mime: this.rec.mimeType || mime || 'audio/webm',
      inicio: ahoraISO(),
      duracion: 0,
      trozos: 0,
      activa: true,
      hablantes: [{ t: 0, quien }],
      marcas: [],
      en_vivo: [],
    };
    obra.grabaciones.push(this.g);
    this.acumulado = 0;
    this.desde = performance.now();
    this.pendiente = Promise.resolve();
    this.rec.ondataavailable = (e) => {
      if (!e.data?.size) return;
      const g = this.g, n = g.trozos++;
      const o = this.obra;
      // En cadena, para que los trozos queden en orden aunque el disco tarde.
      this.pendiente = this.pendiente.then(() => db.guardarBlob(db.idTrozo(g.id, n), o.id, e.data)).then(() => {
        g.duracion = Math.round(this.segundos() * 10) / 10;
        this.alGuardar();
      }).catch((err) => console.error('No se guardó un trozo de audio', err));
    };
    this.rec.start(5000);
    this.estado = 'grabando';
    await this.mantenerPantalla();
    this.alCambiar();
  }

  pausar() {
    if (this.estado !== 'grabando') return;
    this.rec.pause();
    this.acumulado += (performance.now() - this.desde) / 1000;
    this.estado = 'pausa';
    this.alCambiar();
  }

  seguir() {
    if (this.estado !== 'pausa') return;
    this.rec.resume();
    this.desde = performance.now();
    this.estado = 'grabando';
    this.alCambiar();
  }

  async terminar() {
    if (this.estado === 'quieto') return;
    const fin = new Promise((ok) => { this.rec.onstop = ok; });
    if (this.estado === 'grabando') this.acumulado += (performance.now() - this.desde) / 1000;
    this.estado = 'quieto';
    this.rec.stop();
    await fin;
    await this.pendiente;
    cerrarStream(this.stream);
    this.g.duracion = Math.round(this.acumulado * 10) / 10;
    this.g.activa = false;
    this.soltarPantalla();
    const g = this.g;
    this.g = null;
    this.alGuardar();
    this.alCambiar();
    return g;
  }

  cambiarHablante(quien) {
    if (!this.g) return;
    const ult = this.g.hablantes.at(-1);
    if (ult?.quien === quien) return;
    this.g.hablantes.push({ t: Math.round(this.segundos() * 10) / 10, quien });
    this.alGuardar();
  }

  hablante() {
    return this.g?.hablantes.at(-1)?.quien || 'dueno';
  }

  marcar(datos) {
    if (!this.g) return null;
    const m = { id: uuid(), t: Math.round(this.segundos() * 10) / 10, quien: this.hablante(), foto: null, texto: '', ...datos };
    this.g.marcas.push(m);
    this.alGuardar();
    return m;
  }

  stream_() {
    return this.estado === 'quieto' ? null : this.stream;
  }

  async mantenerPantalla() {
    try {
      this.bloqueo = await navigator.wakeLock?.request('screen');
    } catch { /* sin wake lock: la pantalla puede apagarse */ }
    if (!this.alVolver) {
      this.alVolver = () => {
        if (document.visibilityState === 'visible' && this.estado !== 'quieto') this.mantenerPantalla();
      };
      document.addEventListener('visibilitychange', this.alVolver);
    }
  }

  soltarPantalla() {
    this.bloqueo?.release?.().catch(() => {});
    this.bloqueo = null;
  }
}

export const grabador = new Grabador();

// Nota de voz corta: mientras se mantiene apretado el botón.
export async function empezarNota() {
  const mime = mimeAudio();
  if (mime === null) throw new Error('Este navegador no puede grabar audio');
  const compartido = grabador.stream_();
  const stream = compartido || (await microfono());
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const partes = [];
  rec.ondataavailable = (e) => e.data?.size && partes.push(e.data);
  rec.start();
  const inicio = performance.now();
  return {
    async terminar() {
      const fin = new Promise((ok) => { rec.onstop = ok; });
      rec.stop();
      await fin;
      if (!compartido) cerrarStream(stream);
      const dur = (performance.now() - inicio) / 1000;
      if (dur < 0.6 || !partes.length) return null; // toque sin querer
      return new Blob(partes, { type: rec.mimeType || mime || 'audio/webm' });
    },
  };
}
