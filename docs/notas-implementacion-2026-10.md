# Archivo de notas del backend: octubre de 2026

Contenido del README anterior al 11 de octubre de 2026. Conserva el contexto de
cada prueba y despliegue; las afirmaciones "solo local" no describen por si solas
el estado actual. No usar este registro como procedimiento de instalacion.

Las rutas `../ops` se refieren al workspace desde la raiz del repositorio antes
de este traslado. Los scripts e informes externos no se incluyen en este repo.

Volver al [README](../readme.md) para la documentacion vigente.

---

# Libretorio backend

## Gestion de usuarios (local, 2026-10-07)

Implementada y activada SOLO en el backend aislado del laboratorio de historial
(`../ops/2026-10-06-history/compose.yaml`, puerto local 3009). Sin despliegue
productivo ni cambios al scanner o metadata-updater en esta entrega.

- Activacion explicita: `ADMIN_USERS_ENABLED=1`. Por defecto las rutas devuelven
  404 y `/api/me` informa `userManagementEnabled:false`.
- Aplicar antes `deploy/migrations/20261007_user_management.sql`: indice UNIQUE
  sobre lower(btrim(email)) y management_revision para ediciones concurrentes.
  La migracion falla ante correos ambiguos; no fusiona cuentas ni borra historia.
- `/api/admin/users`: GET paginado (20), POST alta; PATCH `/:id` edita correo,
  estado y rol; POST `/:id/password` restablece; POST `/:id/revoke` cierra sesion.
  GET admite q, state=active/inactive y before (UUID opaco del servidor).
- `/api/account/password`: cambio propio con password actual. No acepta un ID
  de otra cuenta. No existe ruta DELETE ni eliminacion fisica de usuarios.
- Escrituras requieren CSRF y reautenticacion. Ediciones requieren
  expectedRevision; un conflicto devuelve 409, no sobrescribe el estado nuevo.
  Passwords nuevas: 15-256 caracteres, Argon2, sin reglas de composicion ni
  truncamiento. El limite no altera la verificacion de passwords existentes.
- Rol/estado/sesion se consultan en PG. Una transaccion serializada entre las
  operaciones administrativas protege al ultimo admin activo y registra auditoria
  del servidor junto al cambio. Un fallo de auditoria revierte la operacion.
  Este bloqueo coordina las rutas de la app, no cambios SQL manuales externos.
- Cambiar datos, permisos, estado o password revoca la sesion de esa cuenta;
  se conserva historial, preferencias y auditoria. Si afecta a quien opera,
  debe iniciar sesion otra vez. /api/me consulta el rol vigente, no la copia vieja.
- Se notifica el cierre a sockets del proceso tras COMMIT; HTTP y WS mantienen
  la validacion persistida. La comprobacion periodica existente cubre sockets
  inactivos de otros procesos (actualmente el despliegue usa un proceso backend).
  No se promete retirar bytes previamente descargados por un navegador.
- El login comprueba que el hash verificado siga vigente al asignar la sesion:
  una verificacion antigua no sobrevive a un cambio de password concurrente.
- Los logs nuevos no incluyen passwords, hashes ni IDs de sesion. La auditoria
  administrativa no reutiliza el wrapper de consultas que absorbe errores.

Verificacion: 150 tests backend; 17 escenarios de servicio/PG y HTTP/WS reales
en laboratorio; 39 comprobaciones previas de historial/preferencias. Scripts:
`../ops/2026-10-07-users/integration.cjs` y `browser.cjs`. Sus cuentas y esquemas
temporales se eliminan al terminar. No ejecutar contra una base productiva.

La migracion y activacion en produccion requieren revision, respaldo y permiso
de despliegue independientes. No copiar todo el worktree: contiene otros cambios.

## Buscador HTTP local, 2026-10-08

`GET /api/catalogue/search` requiere la sesion existente. No reemplaza el WS
de carpetas. Acepta q/title/author/isbn/description/language/folder/kind,
subfolders=0|1, sort=relevance|title|added y un cursor after o before.
Todos los filtros se parametrizan; cursor vinculado al conjunto de filtros.
Respuesta version=1, hasta 50 items acotados, next/previous y elapsedMs.
No incluye metadata completa, texto del documento, COUNT global ni OFFSET.

Limites por proceso: dos consultas simultaneas, una por usuario, 30/min por
usuario. Adquisicion de conexion 1,5 s; si el pool responde tarde se libera la
conexion sin consultar y el cupo se mantiene mientras siga pendiente, evitando
acumulacion de esperas. Transaccion read-only, statement_timeout 5 s,
work_mem 4 MiB por operacion, max_parallel_workers_per_gather=0. No confundir
work_mem con un limite total de RAM de PostgreSQL. No se cambian parametros
globales ni se agregan indices: prefiltro compatible con GIN existentes y
comprobacion final por campos. Errores SQL no se convierten en lista vacia.

161 pruebas backend correctas, incluida saturacion, timeout de conexion,
rollback y 401. Pruebas read-only de consulta/paginacion/ISBN/idioma sobre
71.187 archives reales: `../ops/2026-10-08-search/production-*.json*`.
API activada solo en backend local 3009/lab 8449. Requiere autorizacion
independiente antes de desplegar; sin migracion nueva para esta busqueda.

## Activacion productiva conjunta, 2026-10-09

Autorizada por el usuario tras revisar la vista movil. Buscador HTTP y gestion
de usuarios publicados junto a la vista nueva. Migracion 20261007 aplicada y
ADMIN_USERS_ENABLED=1; historial y sesion unica conservados. Se integro ademas
requestId de convert_to_pdf, exclusión EPUB->PDF y auditoria para IDs numericos.

La entrega se construyo sobre una captura real: 12 modulos distintos, sin
cambiar package.json/lock, Node, scanner ni metadata-updater. 161 tests del
stage aprobados y 34 comprobaciones por HTTPS publico; respaldo restaurado
en DB temporal local antes de migrar. Codigo/vista originales y configuracion
guardados; no se restaura automaticamente la DB al revertir codigo.

Release remoto: /media/RIGO7/Libretorio-conf/ops/2026-10-09-release/release-yhhuUa2.
Evidencia y detalle del primer intento revertido por el script de pruebas:
`../ops/2026-10-09-release/README.md`. La segunda activacion termino sin nuevos
errores de backend y sin cambiar los PID de los otros 16 procesos PM2.
