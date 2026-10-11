# Libretorio: backend

Backend de la biblioteca web Libretorio. Publica la interfaz compilada, autentica
a los usuarios y conecta los lectores con el catalogo, los archivos y el progreso
de cada cuenta.

La presentacion general del proyecto esta en
**[Libretorio-ng](https://github.com/Rigo85/libretorio-ng#readme)**.

## Responsabilidades

- API HTTP y WebSocket para explorar el catalogo, consultar y editar metadata.
- Entrega autenticada de libros, portadas y cache, con soporte de peticiones por
  rango para lectura y reproduccion.
- Sesiones persistidas, una sesion activa por usuario, proteccion CSRF y
  renovacion controlada por actividad de lectura o reproduccion.
- Actividad reciente paginada, progreso por material y preferencias del usuario.
- Busqueda basica y avanzada del catalogo con filtros y cursores de paginacion.
- Gestion administrativa de cuentas y cambio de contrasena propio. Deshabilitar
  o revocar una cuenta no elimina su historial; no hay borrado fisico de usuarios.

El [scanner](https://github.com/Rigo85/libretorio-scanner) prepara la cache,
la metadata de audio y los PDF derivados. **El backend no genera conversiones
PDF bajo demanda**: consulta su estado y sirve el resultado disponible. EPUB se
abre con su lector propio. El
[metadata-updater](https://github.com/Rigo85/libretorio-metadata-updater) se ocupa
del enriquecimiento bibliografico pendiente.

## Requisitos y configuracion

Node.js `>=24.15.0 <25`, npm, PostgreSQL, Redis y acceso al almacenamiento compartido
de libros, portadas y cache. El proyecto usa TypeScript y Express.

La configuracion parte de [src/config/configuration.ts](src/config/configuration.ts)
y de las variables de entorno. No incluir credenciales reales en el repositorio.

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexion PostgreSQL del servicio. |
| `REDIS_URL` | Conexion Redis. |
| `SESSION_SECRET` | Secreto de sesion propio de la instalacion. |
| `PORT` | Puerto HTTP; por defecto `3005`. |
| `NODE_ENV` | Entorno de ejecucion. |
| `BOOKS_ROOT` | Raiz fisica permitida para la biblioteca. |
| `ALLOWED_ORIGIN` | Origen HTTPS permitido, incluido el handshake WebSocket; configurarlo para cada instalacion. |
| `READING_ENABLED=1` | Habilita historial, progreso y preferencias, tras aplicar sus migraciones. |
| `ADMIN_USERS_ENABLED=1` | Habilita gestion de cuentas, tras aplicar su migracion. |

La estructura base y migraciones de audio/conversiones estan en
[Libretorio-postgresql](https://github.com/Rigo85/libretorio-postgresql).
Las migraciones de historial, usuarios y progreso de comics estan en
[deploy/migrations](deploy/migrations). Revisarlas y respaldar la base antes de
aplicarlas; una instancia PostgreSQL puede contener otras bases y aplicaciones.
No habilitar funciones contra un esquema incompatible.

## Preparacion y ejecucion

**Revisar [copyStaticAssets.ts](copyStaticAssets.ts) antes de instalar.**
`npm ci` ejecuta `postinstall`, que compila y copia recursos: actualmente espera
Calibre en `src/services/calibre`, la vista en `src/browser` y crea enlaces a
rutas concretas de `/media/RIGO7`. No es una instalacion independiente del host.
Aunque la conversion PDF pertenece al scanner, esa copia de Calibre sigue en
el script de build del backend.

Preparar esas rutas y recursos para el entorno elegido, incorporar la compilacion
de la vista y configurar la base antes de ejecutar:

```bash
npm ci
npm test -- --runInBand
npm run build
npm run serve
```

Para comprobaciones separadas estan disponibles `npm run build-ts` y
`npm run lint`. `npm run build` incluye tambien la copia de assets y permisos del
binario de `7zip-bin`. `npm run serve` ejecuta `dist/server.js`; no aplica
migraciones automaticamente.

## Despliegue y seguridad

La vista se compila en su repositorio, se copia a `src/browser/` y se publica con
este backend. El proxy inverso debe conservar autenticacion y cache privada de
libros y derivados, no servirlos directamente como archivos publicos.

Comprobar GET, HEAD y Range sin sesion: deben devolver `401`, no un archivo ni
HTML de login. Con sesion valida, comprobar `206` para rangos, logout, sustitucion
de sesion y funcionamiento de lectores. Una ruta conocida no concede acceso.

El ejemplo de Nginx en [deploy/nginx](deploy/nginx) incluye comprobaciones utiles;
sus notas contienen contexto historico y sus rutas/upstream deben revisarse para
cada host. No copiar configuraciones de produccion sin esa verificacion.

## Documentacion y licencia

- [Presentacion y arquitectura de Libretorio](https://github.com/Rigo85/libretorio-ng#readme).
- [Notas historicas de implementacion y despliegue](docs/notas-implementacion-2026-10.md).
- [Licencia AGPL v3](LICENSE.txt). Las dependencias conservan sus propias licencias.
