# Control de Campañas LinkedIn

App de TiTi-Apps para el servicio de generación y calificación de contactos en LinkedIn, operado para varias empresas a la vez.

- **Semáforo:** vencidas, vencen en 1 día, vencen en 3 días, en tiempo y completadas, por empresa y por persona.
- **Actividades:** cada una con empresa, uno o varios responsables, fecha de inicio, fecha compromiso, prioridad y estado.
- **Personal:** perfiles Admin, Project manager, Community manager, Diseñador gráfico, Telemarketer y Analista de datos; líderes globales; empresas asignadas.
- **Empresas:** fecha de arranque y botón para cargar el plan de trabajo de 6 meses (44 actividades asignadas por perfil).
- **Orden del día:** correo automático a las 8:00 (lunes a viernes, hora de Ciudad de México) a cada persona con sus actividades abiertas.
- **Correo:** la cuenta que envía la orden del día se configura desde la app como en cualquier programa de correo (SMTP + IMAP). Por ahora: `tdsynnex@titi-apps.com`.

## Novedades de la versión 2

- Los correos ya no usan Cloudflare Email Service: salen de una cuenta de correo normal con usuario y contraseña.
- Nuevo módulo **Correo** (solo líderes globales): proveedor, servidores SMTP e IMAP, botón **Guardar y probar conexión** y opción de guardar copia de cada correo en la carpeta de Enviados.
- La contraseña se guarda cifrada (AES-GCM) con el secreto `CLAVE_CORREO` y nunca se devuelve al navegador.
- Ya no hace falta verificar `titi-apps.com` en Email Service ni agregar sus registros DNS.
- Si ya publicaste la versión 1: haz push de esta versión (la migración `0003_cuenta_correo.sql` se aplica sola), crea el secreto `CLAVE_CORREO` (paso 3) y configura la cuenta en **Correo**.

## Cómo está hecha

| Pieza | Servicio de Cloudflare | Dónde está |
| --- | --- | --- |
| Pantalla (HTML + JS) | Workers Static Assets | `public/` |
| API | Worker | `src/index.js` |
| Base de datos | D1 (SQLite) | `migrations/` |
| Inicio de sesión | Cloudflare Access (Zero Trust) | `src/auth.js` |
| Correo de las 8:00 | Cron Trigger | `src/orden.js` |
| Envío por SMTP | Sockets TCP + [worker-mailer](https://www.npmjs.com/package/worker-mailer) | `src/correo.js` |
| Prueba de acceso y copia en Enviados | Sockets TCP (IMAP) | `src/imap.js`, `src/mime.js` |
| Plan de trabajo de 6 meses | — | `src/plan.js` |
| Fechas y semáforo (compartido) | — | `public/js/logica.js` |

Permisos dentro de la app:

- **Líderes globales** (marcados en Personal, o en `ADMIN_EMAILS`): todo, incluido personal, empresas, plan de trabajo, eliminar, la cuenta de correo y enviar la orden del día manualmente.
- **Personal registrado:** crea y edita actividades; cambia el estado solo de las actividades donde es responsable.
- **Correo con acceso pero no registrado:** solo consulta.

Cada cambio queda en la tabla `historial` (quién, qué y cuándo).

---

## Requisitos

- Cuenta de Cloudflare con el dominio **titi-apps.com** administrado en Cloudflare (DNS en Cloudflare).
- Una cuenta de correo con acceso IMAP/SMTP habilitado (por ahora `tdsynnex@titi-apps.com`) y su contraseña o contraseña de aplicación.
- El plan gratuito de Workers alcanza para esta versión (D1, cron y sockets TCP); confírmalo en tu cuenta si el equipo crece mucho.
- Cuenta de GitHub y Node.js 20 o superior en tu computadora.

## 1. Subir el proyecto a GitHub

1. En GitHub crea un repositorio **privado** vacío llamado `control-campanas` (sin README).
2. En la carpeta del proyecto:

```bash
git init
git add .
git commit -m "Control de Campañas LinkedIn: versión inicial"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/control-campanas.git
git push -u origin main
```

`.gitignore` ya excluye `node_modules`, `.wrangler` y `.dev.vars`.

## 2. Crear la base de datos D1

```bash
npm install
npx wrangler login
npx wrangler d1 create control-campanas
```

Copia el `database_id` que imprime y pégalo en `wrangler.jsonc` en lugar de `REEMPLAZAR_CON_DATABASE_ID`. Luego crea las tablas y los datos iniciales (Beto, Jeanette, Estefanía y MarkkiBox):

```bash
npm run db:migrar
```

## 3. Crear la clave que protege la contraseña del correo

La contraseña de la cuenta se guarda cifrada en D1 con una clave que solo conoce el Worker:

```bash
openssl rand -base64 32          # copia el resultado
npx wrangler secret put CLAVE_CORREO
```

Pega el valor cuando lo pida. Guárdalo también en tu gestor de contraseñas: si cambias la clave, tendrás que volver a capturar la contraseña del correo en la app.

## 4. Publicar desde GitHub (Workers Builds)

1. Cloudflare > **Workers & Pages > Create > Import a repository** y elige `control-campanas`.
2. En la configuración de build:
   - **Build command:** déjalo vacío.
   - **Deploy command:** `npx wrangler d1 migrations apply control-campanas --remote && npx wrangler deploy`
3. Guarda. Desde ahora, cada `git push` a `main` publica una versión nueva y aplica las migraciones pendientes de la base de datos.

Si el build marca un error de permisos al aplicar migraciones, deja el deploy command en `npx wrangler deploy` y aplica las migraciones a mano con `npm run db:migrar` cuando agregues una nueva.

La app queda en `https://campanas.titi-apps.com` (definido en `routes` de `wrangler.jsonc`; cámbialo ahí si prefieres otro subdominio).

## 5. Proteger la app con Cloudflare Access

Sin este paso la API responde "Acceso no autorizado" a todos.

1. Cloudflare > **Zero Trust > Access > Applications > Add an application > Self-hosted**.
2. **Application domain:** `campanas.titi-apps.com`.
3. **Policy:** Action *Allow*, regla *Emails* con los correos del equipo (o *Emails ending in* `@titi-apps.com`).
4. **Login method:** One-time PIN (llega un código al correo) o Google, si lo tienes configurado.
5. Guarda y copia el **Application Audience (AUD) Tag** de la aplicación.
6. Copia tu **team domain** (Zero Trust > Settings > Custom Pages), por ejemplo `titi.cloudflareaccess.com`.
7. Pega ambos en `wrangler.jsonc`, en `ACCESS_AUD` y `ACCESS_TEAM_DOMAIN`, haz commit y push.

Cada persona entra con el mismo correo con el que está dada de alta en **Personal**. Para agregar a alguien: dalo de alta en la app y agrega su correo a la política de Access.

## 6. Primeros pasos en la app

1. Entra a `https://campanas.titi-apps.com` con `beto.garcia@titi-apps.com`.
2. En **Personal**, completa el correo de Jeanette y Estefanía y da de alta al equipo con su perfil y sus empresas.
3. En **Empresas**, pon la fecha de arranque de MarkkiBox, agrega las otras tres y usa **Cargar plan de trabajo** en cada una.
4. En **Correo** ya vienen los servidores de FatCow para `tdsynnex@titi-apps.com`: escribe su contraseña y usa **Guardar y probar conexión**. Deben salir SMTP e IMAP como correctos.
5. En **Orden del día**, usa **Enviar ahora a esta persona** contigo para probar el correo.

## Configurar la cuenta de correo por proveedor

| Proveedor | SMTP | IMAP | Antes de probar |
| --- | --- | --- | --- |
| **FatCow / Network Solutions (titi-apps.com)** | smtp.fatcow.com · 465 · SSL | imap.fatcow.com · 993 · SSL | Ya viene precargado. Usuario = correo completo, misma contraseña del webmail. Si Network Solutions ya movió el buzón a su plataforma y falla la prueba, busca tus servidores en `webmail5b.networksolutionsemail.com/settings/` y usa "Otro proveedor". |
| Zoho Mail (dominio propio) | smtppro.zoho.com · 465 · SSL | imappro.zoho.com · 993 · SSL | Activa IMAP en Zoho Mail (Configuración > Correo > IMAP); con verificación en dos pasos usa una contraseña específica de aplicación. |
| Google Workspace | smtp.gmail.com · 465 · SSL | imap.gmail.com · 993 · SSL | Verificación en dos pasos + contraseña de aplicación. Desactiva "Guardar copia" (Gmail ya la guarda). |
| Microsoft 365 | smtp.office365.com · 587 · STARTTLS | outlook.office365.com · 993 · SSL | Microsoft ya no acepta contraseña en IMAP y bloquea SMTP AUTH por omisión: el administrador debe habilitar "SMTP autenticado" en el buzón. Es el proveedor menos recomendable para este uso. |
| Hostinger | smtp.hostinger.com · 465 · SSL | imap.hostinger.com · 993 · SSL | Contraseña del buzón creada en hPanel. |
| GoDaddy (Workspace Email) | smtpout.secureserver.net · 465 · SSL | imap.secureserver.net · 993 · SSL | — |
| Hosting con cPanel | mail.titi-apps.com · 465 · SSL | mail.titi-apps.com · 993 · SSL | Confírmalo en cPanel > Cuentas de correo > Conectar dispositivos. |

Si no sabes quién hospeda el correo de `titi-apps.com`, revisa los registros MX del dominio en Cloudflare (DNS): `mx.zoho.com` es Zoho, `aspmx.l.google.com` es Google, `*.mail.protection.outlook.com` es Microsoft 365.

Notas:

- Cloudflare no permite conexiones al puerto 25; usa 465 (SSL) o 587 (STARTTLS).
- Algunos proveedores avisan de un "inicio de sesión desde una ubicación nueva" la primera vez, porque la conexión sale de servidores de Cloudflare. Autorízalo y repite la prueba.
- Si ves cada correo dos veces en Enviados, desactiva "Guardar copia": tu proveedor ya la guarda solo.
- El historial de la app registra quién cambió la cuenta de correo, nunca la contraseña.

## Probar en tu computadora

```bash
cp .dev.vars.ejemplo .dev.vars
npm run db:migrar:local
npm run dev
```

En `.dev.vars` pon una `CLAVE_CORREO` propia (`openssl rand -base64 32`). Abre `http://localhost:8787`: entras como el correo de `DEV_USER_EMAIL` (sin Access). En local los correos sí salen por SMTP con la cuenta que configures, así que prueba con tu propio correo como destinatario. Para simular el cron de las 8:00 visita `http://localhost:8787/__scheduled?cron=0+14+*+*+1-5`.

**Nunca** configures `ENTORNO` ni `DEV_USER_EMAIL` como variables o secretos en Cloudflare: saltan el inicio de sesión. `CLAVE_CORREO` sí va en Cloudflare, siempre como secreto (`wrangler secret put`), nunca en `wrangler.jsonc`.

## Control de cambios

- Trabaja cada cambio en una rama (`git checkout -b ajuste-semaforo`) y abre un Pull Request a `main`; al hacer merge se publica solo.
- Cambios a la base de datos: crea un archivo nuevo en `migrations/` (`npx wrangler d1 migrations create control-campanas descripcion`). No edites migraciones ya aplicadas.
- Para regresar a una versión anterior: Cloudflare > Workers > control-campanas > **Deployments > Rollback**, o `git revert` y push.
- Respaldo de datos: `npx wrangler d1 export control-campanas --remote --output respaldo.sql`. D1 también permite restaurar a cualquier punto de los últimos 30 días (Time Travel).

## Ajustes frecuentes

| Quiero cambiar… | Dónde |
| --- | --- |
| Hora o días del correo | `triggers.crons` en `wrangler.jsonc` (está en UTC: 14:00 UTC = 8:00 CDMX) |
| Cuenta, remitente o contraseña del correo | Módulo **Correo** dentro de la app |
| Umbrales del semáforo | función `sem()` en `public/js/logica.js` |
| Actividades del plan de 6 meses | `planBase()` en `src/plan.js` (y `N_PLAN` en `public/index.html`) |
| Subdominio | `routes` y `APP_URL` en `wrangler.jsonc`, y la aplicación de Access |
