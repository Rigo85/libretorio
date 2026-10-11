# Revision de dependencias: 2026-10-11

Validacion con Node 24.21.0 y npm 11.16.0. Esta revision no despliega produccion.

## Cambios

- `shell-quote`: 1.10.0 -> 1.12.0; `handlebars`: 4.7.9 -> 4.7.10.
- Se elimina `sharp`, sin consumidores en el codigo del backend.
- Se elimina la dependencia directa `chokidar`, sin consumidores propios.
  Nodemon conserva su dependencia de desarrollo y su watcher.
- Se conserva el resto de versiones; no se agregan overrides ni se fuerza audit.

## Verificacion

- Instalacion limpia; arbol de dependencias valido; build y 172 tests correctos.
- El build detecto un incumplimiento de lint previo en los dos archivos de
  busqueda. Se corrige el formato por separado, sin alterar el codigo ejecutable.
  Los cursores JSON mantienen `null`; no se sustituyen por `undefined`.
- Instalacion separada con `npm ci --omit=dev --ignore-scripts`: no contiene
  sharp, chokidar, braces, shell-quote, handlebars ni sprintf-js.
- Nodemon reinicia ante un cambio de archivo; Concurrently ejecuta los comandos.
- Arranque y apagado correctos con PostgreSQL/Redis aislados y solo dependencias
  de produccion. Se verifican el bundle Angular, CSRF, respuestas 401 sin sesion
  y hash/verificacion con Argon2. No se utiliza la base ni el catalogo productivos.
- `npm audit --omit=dev`: **0 vulnerabilidades**, frente a 3 altas anteriores.
- Auditoria completa: **30 altas y 5 moderadas, 0 criticas**. El total incluye
  dependientes afectados; se reduce desde 38 y corresponde a dos avisos pendientes.

## Pendientes de desarrollo

- [braces, GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm):
  cadena de Nodemon/Jest/micromatch.
- [sprintf-js, GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c):
  cadena de Istanbul/js-yaml/argparse.

No existe version corregida publicada de esos paquetes en esta revision.
No exponer esas herramientas a entradas no confiables. Revisar parches compatibles
cuando se publiquen; no reemplazar Jest/Nodemon por versiones antiguas para ocultar
las alertas. El riesgo residual no se considera un falso positivo.

Persisten avisos de deprecacion de `string-similarity` y transitivos de desarrollo
como `inflight`/`glob`. Su sustitucion necesita otra revision; no se fuerza aqui.

## Instalacion

El `postinstall` existente compila y requiere las herramientas de desarrollo.
Para construir, instalar dependencias completas y ejecutar `npm run build` con
Calibre y el bundle Angular preparados. Para un artefacto ya compilado, instalar
con `npm ci --omit=dev --ignore-scripts` y ejecutar `npm run 7z-perm`.
No eliminar devDependencies antes de construir ni confundir el arbol de pruebas
con el que se entrega a produccion.
