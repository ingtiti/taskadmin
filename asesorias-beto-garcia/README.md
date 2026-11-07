# Calendario de Asesorías Beto García

App web de **Titiapps** para reservar sesiones de asesoría personalizada de emprendimiento (1 hora cada una).

- **Calendario público** (`/`): única vista pública. **Solo se reserva de mañana en adelante**: el día de hoy y los pasados aparecen bloqueados (también lo valida el servidor). Muestra por mes los horarios **Disponibles** (verde) y **Ocupados** (gris). Al elegir uno se abre un formulario con la fecha y hora **fijas (no editables)** que pide nombre completo y correo.
- **Bloqueo inmediato**: al enviar la solicitud el espacio pasa a **Ocupado** de forma atómica (dos personas no pueden tomar el mismo horario).
- **Correos de confirmación** al asesorado y a ti, con invitación `.ics` adjunta, enviados desde tu cuenta de **Exchange**.
- **Enlace de Google Meet**: cada cita genera su propia videollamada de Google Meet; el enlace va en el correo, en la invitación `.ics` y en los eventos de Google y Exchange (alternativa: Microsoft Teams).
- **Calendario de Exchange**: cada cita se crea en tu calendario.
- **Réplica en Google Calendar (Gmail)**: cada cita se copia también a tu calendario de Gmail.
- **Panel de administración** (`/admin/`, solo tú): publicar espacios de 1 hora (por rango de fechas, días y horas), ver y cancelar reservas, reintentar envíos fallidos, configurar el servidor de correo y los calendarios, e historial de cambios.
- Pie de página con el logo de Titiapps: "Desarrollado por Titiapps y Claude".

## Cómo está hecha

| Pieza | Servicio | Dónde |
| --- | --- | --- |
| Pantallas (HTML/CSS/JS sin compilación) | Cloudflare Workers Static Assets | `public/` (`index.html` público, `admin/index.html` panel) |
| API | Cloudflare Worker | `src/index.js` |
| Base de datos | Cloudflare D1 (SQLite) | `migrations/` |
| Acceso exclusivo al panel | Cloudflare Access (Zero Trust) + lista `ADMIN_EMAILS` | `src/auth.js` |
| Correo y calendario de Exchange | Microsoft Graph (Exchange Online / Microsoft 365) | `src/graph.js` |
| Correo por SMTP (alternativa, Exchange Server local) | Sockets TCP + worker-mailer | `src/correo.js` |
| Réplica en Gmail | Google Calendar API (OAuth 2.0) | `src/google.js` |
| Invitación de calendario | iCalendar (.ics) | `src/ics.js` |
| Plantillas de correo | — | `src/plantillas.js` |
| Reintento automático cada 10 min | Cron Trigger | `scheduled()` en `src/index.js` |
| Secretos (contraseñas, client secrets, refresh token) | Cifrados con AES-GCM en D1 con el secreto `CLAVE_CIFRADO` | `src/cifrado.js` |
| Anti-robots (opcional) | Cloudflare Turnstile | `TURNSTILE_SITEKEY` / `TURNSTILE_SECRET` |

Rutas:

- `/` calendario público · `/api/publico/*` API pública (solo devuelve horario y estado; nunca datos de quien reservó).
- `/admin/` panel · `/api/admin/*` API del panel (exige el token de Cloudflare Access **y** que el correo esté en `ADMIN_EMAILS`).

Reglas configurables en `wrangler.jsonc` (`vars`): zona horaria (`America/Mexico_City`), y máximo de citas próximas por correo (`MAX_RESERVAS_POR_EMAIL`, 2).

---

## Requisitos

- Cuenta de Cloudflare con el dominio `titi-apps.com` (ya lo tienes para *Control de Campañas*).
- Cuenta de GitHub y Node.js 20 o superior en tu computadora.
- Cuenta de **Microsoft 365 / Exchange Online** con permiso de administrador del directorio (para registrar la app de Graph). Si tu Exchange es local (Exchange Server), usa el modo SMTP.
- Cuenta de **Gmail** (o Google Workspace) para la réplica del calendario.

> Todo cabe en el plan gratuito de Workers y D1 para el volumen de un calendario de asesorías.

---

## Paso 1. Guardar el proyecto en GitHub

Este proyecto vive en la carpeta `asesorias-beto-garcia/` del repositorio `taskadmin`. Tienes dos opciones:

**Opción A (recomendada): repositorio propio.** Más fácil de mantener y de conectar a Cloudflare.

```bash
# Desde la raíz del repositorio taskadmin, ya con esta rama descargada
cp -R asesorias-beto-garcia ~/asesorias-beto-garcia
cd ~/asesorias-beto-garcia
git init
git add .
git commit -m "Calendario de Asesorías Beto García: versión inicial"
git branch -M main
# Crea antes en GitHub un repositorio PRIVADO vacío llamado asesorias-beto-garcia (sin README)
git remote add origin https://github.com/TU-USUARIO/asesorias-beto-garcia.git
git push -u origin main
```

**Opción B: dejarlo dentro de `taskadmin`.** Haz merge de la rama `claude/beto-garcia-booking-calendar-8ux5ra` a `main` y, en el paso 6, indica `asesorias-beto-garcia` como **Root directory** del build.

`.gitignore` ya excluye `node_modules`, `.wrangler` y `.dev.vars` (nunca subas contraseñas a GitHub).

## Paso 2. Instalar y crear la base de datos D1

```bash
cd asesorias-beto-garcia
npm install
npx wrangler login
npx wrangler d1 create asesorias-beto-garcia
```

Copia el `database_id` que imprime y pégalo en `wrangler.jsonc` en lugar de `REEMPLAZAR_CON_DATABASE_ID`. Después crea las tablas:

```bash
npm run db:migrar
```

## Paso 3. Revisar `wrangler.jsonc`

- `APP_URL` y `routes`: el subdominio público, por omisión `asesorias.titi-apps.com`.
- `ADMIN_EMAILS`: tu correo (`beto.garcia@titi-apps.com`). Solo estas cuentas entran al panel.
- `ZONA_HORARIA` y `MAX_RESERVAS_POR_EMAIL` si quieres otras reglas.

## Paso 4. Crear la clave de cifrado (secreto)

Las contraseñas y secretos que captures en la app se guardan cifrados con esta clave:

```bash
openssl rand -base64 32          # copia el resultado
npx wrangler secret put CLAVE_CIFRADO
```

Guárdala también en tu gestor de contraseñas. Si la cambias, tendrás que volver a capturar los secretos en **Correo y calendarios**.

## Paso 5. Primer despliegue

```bash
npm run deploy
```

La app queda en `https://asesorias.titi-apps.com` (Cloudflare crea el registro DNS y el certificado del dominio propio automáticamente). También se publica en `https://asesorias-beto-garcia.<tu-subdominio>.workers.dev`; puedes desactivarlo poniendo `"workers_dev": false`.

## Paso 6. Despliegue automático desde GitHub (Workers Builds)

1. Cloudflare > **Workers & Pages** > `asesorias-beto-garcia` > **Settings > Builds > Connect** y elige el repositorio.
2. Configuración del build:
   - **Root directory:** vacío en la opción A; `asesorias-beto-garcia` en la opción B.
   - **Build command:** vacío.
   - **Deploy command:** `npx wrangler d1 migrations apply asesorias-beto-garcia --remote && npx wrangler deploy`
   - **Branch:** `main`.
3. Desde ahora cada `git push` a `main` publica una versión nueva y aplica las migraciones pendientes.

Si el build falla por permisos al aplicar migraciones, deja el deploy command en `npx wrangler deploy` y aplica las migraciones a mano con `npm run db:migrar`.

## Paso 7. Proteger el panel con Cloudflare Access (solo tú)

1. Cloudflare > **Zero Trust > Access > Applications > Add an application > Self-hosted**.
2. Nombre: `Asesorías · Admin`. Agrega **dos** destinos (Public hostnames):
   - `asesorias.titi-apps.com` con path `admin`
   - `asesorias.titi-apps.com` con path `api/admin`
3. **Policy:** Action *Allow*, regla *Emails* = `beto.garcia@titi-apps.com` (solo tu correo).
4. **Login method:** One-time PIN o tu proveedor de identidad.
5. Guarda y copia el **Application Audience (AUD) Tag**. Pégalo en `ACCESS_AUD` de `wrangler.jsonc`; revisa que `ACCESS_TEAM_DOMAIN` sea tu team domain (`titiapps.cloudflareaccess.com`). Haz commit y push.

El calendario público (`/` y `/api/publico/*`) queda abierto; todo lo de `/admin` pide tu inicio de sesión. Aunque alguien llegue a la API por otra ruta, el Worker verifica el token de Access y que el correo esté en `ADMIN_EMAILS`.

## Paso 8. Conectar Exchange (Microsoft Graph) — correos y calendario

1. Entra a <https://entra.microsoft.com> > **Applications > App registrations > New registration**.
   - Nombre: `Calendario de Asesorías`. Tipo de cuenta: *Single tenant*. Sin Redirect URI. **Register**.
2. Copia el **Application (client) ID** y el **Directory (tenant) ID**.
3. **Certificates & secrets > New client secret** (24 meses). Copia el **Value** (solo se muestra una vez). Anota en tu agenda cuándo vence.
4. **API permissions > Add a permission > Microsoft Graph > Application permissions**: agrega `Mail.Send` y `Calendars.ReadWrite`. Luego **Grant admin consent**.
5. *(Recomendado)* Limita la app a tu buzón con una política de acceso de aplicaciones de Exchange (RBAC for Applications), desde PowerShell de Exchange Online:

   ```powershell
   Connect-ExchangeOnline
   New-ServicePrincipal -AppId <CLIENT_ID> -ObjectId <OBJECT_ID_DEL_ENTERPRISE_APP> -DisplayName "Calendario de Asesorías"
   New-ManagementScope -Name "Solo Beto" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'beto.garcia@titi-apps.com'"
   New-ManagementRoleAssignment -App <CLIENT_ID> -Role "Application Mail.Send" -CustomResourceScope "Solo Beto"
   New-ManagementRoleAssignment -App <CLIENT_ID> -Role "Application Calendars.ReadWrite" -CustomResourceScope "Solo Beto"
   ```

   Si usas esta opción, quita los permisos `Mail.Send` y `Calendars.ReadWrite` del paso 4 en Entra (RBAC los reemplaza).
6. En la app: **/admin/ > Correo y calendarios** > modo **Exchange Online (Microsoft Graph)**, pega Tenant ID, Client ID, Client secret y tu buzón; marca **Crear cada cita en mi calendario de Exchange**. **Guardar y probar conexión** y luego **Enviarme un correo de prueba**.

**¿Exchange Server local (on-premises)?** Elige el modo **Servidor SMTP**: servidor (ej. `mail.titi-apps.com`), puerto `587` + STARTTLS (o `465` + SSL), usuario, contraseña y correo remitente. Cloudflare no permite el puerto 25. En este modo la cita llega a tu calendario mediante la invitación `.ics` del correo que recibes. *Nota:* Microsoft retiró la autenticación básica de SMTP en Exchange Online, por eso para Microsoft 365 se usa Graph.

## Paso 9. Google Calendar (Gmail) y enlaces de Google Meet

Este paso es **obligatorio para generar los enlaces de Google Meet**: la videollamada se crea en tu cuenta de Google junto con el evento de la cita.

1. Entra a <https://console.cloud.google.com>, crea un proyecto (`asesorias-beto-garcia`).
2. **APIs & Services > Library** > habilita **Google Calendar API**.
3. **Google Auth Platform / OAuth consent screen**: tipo *External*; agrega tu Gmail como usuario de prueba y el alcance `.../auth/calendar.events`.
4. **Importante:** en *Audience / Publishing status* pulsa **Publish app** (*In production*). En modo *Testing* Google vence el acceso cada 7 días. Como es solo para tu uso, no necesitas verificación; al conectar verás un aviso de "app no verificada": elige *Avanzado > Ir a…*.
5. **Clients > Create client > Web application**. En **Authorized redirect URIs** agrega exactamente el URI que muestra la app en **Correo y calendarios** (por omisión `https://asesorias.titi-apps.com/api/admin/google/callback`). Copia Client ID y Client secret.
6. En la app: pega Client ID y Client secret, marca **Replicar cada cita en Google Calendar**, **Guardar**, y luego **Conectar con Google** e inicia sesión con tu Gmail. Debe aparecer "Conectado: tu-correo@gmail.com".
7. En **Enlace de la sesión** deja elegido **Google Meet** (viene así por omisión) y guarda. El asesorado se agrega como invitado del evento (sin que Google le mande otro correo) para que entre directo a la videollamada sin esperar a que lo admitas.
8. *(Opcional)* Para usar un calendario distinto al principal, pon su ID (Google Calendar > Configuración del calendario > *ID del calendario*).

## Paso 10. Logo de Titiapps

El pie de página usa `public/img/titiapps-logo.svg` (incluye un logo provisional). Reemplázalo por el logo oficial con el **mismo nombre**; si tu archivo es PNG, guárdalo como `public/img/titiapps-logo.png` y cambia `titiapps-logo.svg` por `titiapps-logo.png` en `public/index.html` y `public/admin/index.html`. Haz commit y push.

## Paso 11. (Opcional) Anti-robots con Cloudflare Turnstile

1. Cloudflare > **Turnstile > Add widget**, dominio `asesorias.titi-apps.com`, modo *Managed*.
2. Pega el **Site key** en `TURNSTILE_SITEKEY` de `wrangler.jsonc`.
3. `npx wrangler secret put TURNSTILE_SECRET` con el **Secret key**. Commit y push.

## Paso 12. Uso diario

1. **/admin/ > Espacios**: elige (desde mañana) rango de fechas, días y horas de inicio y pulsa **Publicar espacios**. Cada espacio dura 1 hora; los repetidos o traslapados se omiten. Puedes eliminar los que sigan disponibles.
2. Comparte `https://asesorias.titi-apps.com` con tus asesorados.
3. **Reservas**: verás cada cita con el estado de *Correo asesorado*, *Correo para ti*, *Exchange* y *Google*. Si algo falló, pulsa **Reintentar** (además, cada 10 minutos se procesan solas las que quedaron pendientes). Si Google Meet falla, la confirmación al asesorado espera el reintento automático para llegar con el enlace; después de 30 minutos se envía de todos modos y a ti te llega el aviso. **Cancelar** borra los eventos de Exchange y Google, puede liberar el horario y avisar al asesorado.

---

## Probar en tu computadora

```bash
cp .dev.vars.ejemplo .dev.vars    # pon una CLAVE_CIFRADO propia: openssl rand -base64 32
npm run db:migrar:local
npm run dev
```

Abre `http://localhost:8787` (público) y `http://localhost:8787/admin/` (entras como `DEV_USER_EMAIL`, sin Access). Para probar el reintento automático visita `http://localhost:8787/__scheduled?cron=*/10+*+*+*+*`.

**Nunca** configures `ENTORNO` ni `DEV_USER_EMAIL` en Cloudflare: saltan el inicio de sesión. `CLAVE_CIFRADO` y `TURNSTILE_SECRET` van siempre como secretos (`wrangler secret put`).

## Mantenimiento

- Cambios a la base de datos: nuevo archivo en `migrations/` (`npx wrangler d1 migrations create asesorias-beto-garcia descripcion`); no edites migraciones ya aplicadas.
- Respaldo: `npx wrangler d1 export asesorias-beto-garcia --remote --output respaldo.sql`. D1 permite además restaurar a cualquier punto de los últimos 30 días (Time Travel).
- Regresar a una versión anterior: Cloudflare > Workers > `asesorias-beto-garcia` > **Deployments > Rollback**.
- Registros de errores: Cloudflare > Workers > `asesorias-beto-garcia` > **Logs** (observabilidad activada).
- Renueva el client secret de Microsoft antes de que venza y captúralo de nuevo en **Correo y calendarios**.

| Quiero cambiar… | Dónde |
| --- | --- |
| Textos de los correos | `src/plantillas.js` |
| Colores y diseño | `public/css/estilos.css` |
| Horas sugeridas al publicar espacios | `pintarHoras()` en `public/js/admin.js` |
| Anticipación mínima / máximo de citas por correo | `vars` en `wrangler.jsonc` |
| Subdominio | `routes` y `APP_URL` en `wrangler.jsonc`, la app de Access y el redirect URI de Google |
