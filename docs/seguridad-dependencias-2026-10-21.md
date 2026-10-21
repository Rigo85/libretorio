# Revision de seguridad: 2026-10-21

Revision local de tres alertas Dependabot abiertas. Sin despliegue, commit/push,
modificaciones de base de datos ni cierre manual de alertas.

## Correcciones

`follow-redirects` pasa de 1.16.0 a 1.16.1 en el lockfile, dentro del rango
permitido por Axios. No cambian las dependencias directas ni el codigo del
servicio. Corrige las alertas #119 y #120:

- [Cabeceras en array](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8):
  credenciales reenviadas al seguir una redireccion a otro origen.
- [Escape de nombres sensibles](https://github.com/advisories/GHSA-8r9p-f939-6h3c):
  nombres de cabecera interpretados como expresiones regulares.

Se agregan dos regresiones con servidores loopback desechables, sin credenciales
reales ni conexiones productivas. Verifican retirada de Authorization/Cookie en
array y de una cabecera sensible con `^`, conservando una cabecera ordinaria.
Ambas fallan por fuga de cabeceras con 1.16.0 y pasan con 1.16.1.

## Verificacion

- Node 24.21.0 y npm 11.16.0, en un stage aislado bajo `/media/work`.
- Instalacion limpia `npm ci --ignore-scripts`; `npm ls --all` correcto.
- 188 tests aprobados en 17 suites, incluidas las dos regresiones nuevas.
- Build completo, TypeScript y lint correctos, con el bundle Angular corregido.
- `npm audit --omit=dev`: cero vulnerabilidades.
- Auditoria completa: 23 entradas afectadas (3 altas, 20 moderadas), derivadas
  de los dos avisos pendientes siguientes, no 23 fallos independientes.

No se reemplazaron los node_modules del proyecto original ni los de produccion.
Se debe instalar desde el lock corregido al preparar el despliegue.

## Pendientes sin parche compatible

1. [sprintf-js, GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c),
   alerta GitHub #113: la ultima version publicada 1.1.3 tambien esta afectada.
   Entra por Jest -> babel-plugin-istanbul -> @istanbuljs/load-nyc-config ->
   js-yaml 3 -> argparse 1. La ultima version del padre consultada (1.1.0)
   conserva esa cadena. Forzar js-yaml 4 o argparse 2 cambia APIs y no es una
   solucion compatible demostrada; no se hizo.
2. [braces, GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
   detectado por npm: ultima version publicada 3.0.3 sin correccion.

Ambos estan en herramientas de desarrollo/pruebas, no en las dependencias de
produccion. No procesar configuraciones o patrones no confiables con estas
herramientas. No ocultar alertas ni aplicar los downgrades sugeridos por audit.
Revisar las correcciones upstream cuando esten disponibles.
