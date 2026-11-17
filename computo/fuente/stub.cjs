module.exports = new Proxy({}, { get: (t, k) => () => { throw new Error('no disponible en la demo: ' + String(k)); } });
