# Demo del cómputo (fugapy.com/computo)

La página de `computo.fugapy.com` (servidor/publico del repo privado `Alexx389/fuga-computo`) con el motor corriendo en el navegador:
`motor.cjs` atiende las rutas `/api/*` que usa la página (estado, aceptar, computar, recalcular, sugerencia, planos), sin servidor ni link.
El plano no sale de la compu de quien lo sube. DWG con LibreDWG (`@mlightcad/libredwg-web` 0.8.2) servido desde `libredwg/`.

Armar (con `fuga-computo` clonado al lado de esta carpeta, en `../fuga-computo`):

```bash
npx esbuild motor.cjs --bundle --minify --format=iife --platform=browser --target=es2020 --legal-comments=none \
  --alias:zlib=./stub.cjs --alias:crypto=./stub.cjs --alias:@anthropic-ai/sdk=./stub.cjs --alias:fs=./stub.cjs \
  --alias:path=./stub.cjs --alias:os=./stub.cjs --alias:child_process=./stub.cjs --alias:worker_threads=./stub.cjs --outfile=../motor.js
```

`index.html` y `recursos/` son copias de `servidor/publico` con `/recursos/` → `/computo/recursos/`, el token fijo en `"demo"`
(app.js y app-clasico.js) y `motor.js` cargado antes de `app.js`.
