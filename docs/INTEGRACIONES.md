# Integraciones de VoxPro: Kraken, Aware y Zoom

Este documento explica **cómo y por qué** VoxPro se conecta a cada sistema externo.
Está escrito para que cualquier desarrollador nuevo pueda entender la arquitectura
sin tener que rastrear el código durante horas.

---

## Índice

1. [Contexto general](#1-contexto-general)
2. [Kraken (servidor SSH/SFTP)](#2-kraken-servidor-sshsftp)
3. [Aware (servidores de grabación)](#3-aware-servidores-de-grabación)
4. [Zoom Phone](#4-zoom-phone)
5. [Flujo completo de una auditoría](#5-flujo-completo-de-una-auditoría)
6. [Variables de entorno requeridas](#6-variables-de-entorno-requeridas)
7. [Errores comunes y su causa real](#7-errores-comunes-y-su-causa-real)

---

## 1. Contexto general

VoxPro es un sistema de auditoría de calidad para call centers. Su trabajo es:

1. **Descubrir** grabaciones de llamadas (de Aware o Zoom).
2. **Descargar** el audio de esas grabaciones.
3. **Transcribir y evaluar** la llamada con Google Gemini.
4. **Presentar** los resultados al auditor.

Las grabaciones viven en dos sistemas distintos:
- **Aware**: sistema de grabación de telefonía IP instalado en servidores físicos dentro de la red interna del call center.
- **Zoom Phone**: servicio en la nube de Zoom para grabaciones de llamadas por extensión.

VoxPro **no puede acceder directamente** a los servidores Aware porque están en una red privada (`10.255.255.x`) y el backend de VoxPro corre en un servidor con IP pública (`200.91.204.51`). La solución es **Kraken**, un servidor intermediario.

```
Internet
    │
    ▼
VoxPro Backend (200.91.204.51)
    │
    │  SSH / SFTP
    ▼
Kraken (10.255.255.95)          ← servidor puente en la red interna
    │
    ├──► Aware AWARE_30 (10.255.255.30)
    ├──► Aware AWARE_31 (10.255.255.31)
    ├──► Aware AWARE_5  (10.255.255.5)
    ├──► Aware AWARE_32 (10.255.255.32)
    ├──► Aware AWARE_8  (10.255.255.8)
    ├──► Aware AWARE_4  (10.255.255.4)
    ├──► Aware AWARE_34 (10.255.255.34)
    └──► Aware AWARE_6  (10.255.255.6)
```

---

## 2. Kraken (servidor SSH/SFTP)

**IP:** `10.255.255.95`
**Puerto SSH:** `22`
**Usuario:** `tecnologia`
**Autenticación:** llave privada SSH (o password como fallback)

### ¿Qué es Kraken?

Kraken es un servidor Linux dentro de la red interna del call center. Cumple dos funciones para VoxPro:

1. **Almacén de grabaciones históricas**: el escaneo nocturno copia los archivos de audio desde cada servidor Aware hacia Kraken, organizados en:
   ```
   /media/tecnologia/STORAGE/GRABACIONES/
   └── AWARE_30/
       └── 2026/
           └── 04/
               └── 24/
                   ├── Q-13467929017-487910.WAV
                   ├── 13467640147-950459.WAV
                   └── ...
   ```

2. **Puente de red (jump host)**: como Kraken está dentro de la red `10.255.255.x`, VoxPro puede pedirle que abra conexiones TCP hacia los demás servidores Aware en su nombre. Esto se usa tanto para consultar las bases de datos PostgreSQL de Aware como para descargar audio del día actual.

### ¿Cómo se conecta VoxPro a Kraken?

#### SFTP (descarga de archivos históricos)

Se usa para descargar archivos de audio de **días anteriores** que ya fueron sincronizados a Kraken por el escaneo nocturno.

**Servicio:** `src/services/SFTPService.js`

```js
// Conexión directa a Kraken vía SFTP
const sftp = new SFTPService();
await sftp.connect();                             // host: 10.255.255.95
const buffer = await sftp.getFile('/media/tecnologia/STORAGE/GRABACIONES/AWARE_30/2026/04/24/archivo.WAV');
await sftp.disconnect();
```

#### Túnel SSH (acceso a recursos internos)

Se usa para **redirigir conexiones TCP** a través de Kraken hacia otros servidores en la red interna. Kraken actúa como proxy. Hay dos usos:

**a) Túnel hacia PostgreSQL de Aware** — consultas a la base de datos:

```js
// openTunnel(targetHost, targetPort) en RealtimeScanService.js / AwareDBService.js
// VoxPro → SSH Kraken → TCP forward → 10.255.255.30:5432
const tunnel = await openTunnel('10.255.255.30', 5432);
const pgClient = new PGClient({ host: '127.0.0.1', port: tunnel.port, ... });
```

**b) Túnel hacia HTTPS de Aware** — descarga de audio del día actual:

```js
// downloadBufferViaTunnel(url) en RealtimeScanService.js
// VoxPro → SSH Kraken → TCP forward → 10.255.255.30:443
// Permite descargar https://10.255.255.30/audiofiles/... aunque VoxPro no alcance esa IP directamente
const buffer = await downloadBufferViaTunnel('https://10.255.255.30/audiofiles/2026/04/24/archivo.WAV');
```

### ¿Cuándo usa SFTP y cuándo usa túnel SSH?

| Situación | Mecanismo |
|-----------|-----------|
| Audio de grabaciones de días **anteriores** | SFTP directo a Kraken |
| Consulta a PostgreSQL de Aware (en tiempo real o enriquecimiento) | Túnel SSH → PostgreSQL |
| Audio de grabaciones del **día actual** (fallback) | Túnel SSH → HTTPS Aware |
| Audio del día actual (primer intento) | HTTP directo a Aware (sin túnel, si el backend tiene ruta) |

---

## 3. Aware (servidores de grabación)

Aware es un sistema de grabación de llamadas basado en Asterisk/VoIP. Cada servidor Aware gestiona las llamadas de uno o varios clientes del call center. VoxPro interactúa con Aware de tres formas: **base de datos PostgreSQL**, **servidor HTTP de audio** y **almacenamiento en Kraken**.

### Servidores configurados

Definidos en `src/config/sources.js`:

| Carpeta en Kraken | IP del servidor | Cliente | Notas |
|---|---|---|---|
| `AWARE_30` | `10.255.255.30` | `obama` y `lv` | Compartido. LV se distingue por `proyecto_id` (34=LV Ventas, 35=LV Customer) |
| `AWARE_31` | `10.255.255.31` | `obama` | |
| `AWARE_5`  | `10.255.255.5`  | `obama` | |
| `AWARE_32` | `10.255.255.32` | `obama` | |
| `AWARE_8`  | `10.255.255.8`  | `claro_tyt` | |
| `AWARE_4`  | `10.255.255.4`  | `claro_hogar` | |
| `AWARE_34` | `10.255.255.34` | `claro_wcb` | Schema distinto: `awareccm` |
| `AWARE_6`  | `10.255.255.6`  | `reclutamiento` | Filtrado por anexos específicos |

Hay dos esquemas de base de datos:

- **`standard`** (mayoría de servidores): tabla `registro_llamada` con campos `call_id`, `registro_llamada_fono`, `uniqueid`, `agente_id`, etc.
- **`awareccm`** (AWARE_34): misma tabla pero campos distintos; incluye el campo `audiofile` con la ruta del archivo directamente en la DB.

### 3.1 Base de datos PostgreSQL

**Puerto:** `5432`
**Acceso:** túnel SSH a través de Kraken (VoxPro no alcanza la IP de Aware directamente)

**Servicios que lo usan:**
- `src/services/AwareDBService.js` — enriquecimiento nocturno (agente, duración, quién colgó)
- `src/services/RealtimeScanService.js` — consulta en tiempo real de llamadas del día

**¿Para qué se usa?**

El escaneo nocturno encuentra archivos en Kraken pero solo sabe el nombre del archivo. Para saber **qué agente hizo la llamada**, su duración y el proyecto al que pertenece, consulta la base de datos de Aware por `call_id`.

El escaneo en tiempo real (durante el día) consulta directamente el PostgreSQL de Aware para mostrar llamadas del día actual sin esperar al escaneo nocturno.

**Ejemplo de consulta (schema standard):**
```sql
SELECT
  rl.call_id,
  rl.agente_id::text AS agent_id,
  e.empleado_name AS agent_name,
  rl.call_time AS duration,
  rl.registro_llamada_fono AS phone,
  rl.uniqueid
FROM registro_llamada rl
LEFT JOIN empleado e ON rl.agente_id = e.empleado_rut
WHERE rl.registro_llamada_fecha = '2026-04-24'
  AND rl.call_id > 0
```

### 3.2 Servidor HTTP de audio

Cada servidor Aware expone sus archivos de audio vía HTTPS en:
```
https://{ip_servidor}/audiofiles/{YYYY}/{MM}/{DD}/{nombre_archivo}.WAV
```

Ejemplo:
```
https://10.255.255.30/audiofiles/2026/04/24/13467640147-950459.WAV
```

Los certificados son autofirmados, por eso se usa `rejectUnauthorized: false` en las conexiones HTTPS.

**¿Cuándo se usa?**

Exclusivamente para grabaciones del **día actual** seleccionadas en tiempo real (flujo de `selectCall`). Para días anteriores ya están en Kraken y se usa SFTP.

**Servicio:** `src/services/RealtimeScanService.js` → función `downloadBuffer(url)`

### 3.3 Nomenclatura de archivos de audio

Este punto es crítico y causó confusión:

| Tipo de llamada | Formato del nombre de archivo | Ejemplo |
|---|---|---|
| Llamada de cola (inbound queue) | `Q-{telefono}-{call_id}.WAV` | `Q-13467929017-487910.WAV` |
| Llamada directa (outbound/transfer) | `{telefono}-{call_id}.WAV` | `13467640147-950459.WAV` |
| Llamada con uniqueid (dot notation) | `Q-{telefono}-{uniqueid}.WAV` | `Q-+18045077598-1777041937.738424.WAV` |
| Grabación interna/extensión | `{extension}-{call_id}.WAV` | `10-88870.WAV` |

**Problema conocido:** `buildStandardAudioUrl()` en `RealtimeScanService.js` siempre construye la URL con prefijo `Q-`. Esto es incorrecto para llamadas directas. La solución implementada en `AnalysisService.js` y `audit.controller.js` es intentar primero con `Q-` y si retorna 404, intentar sin el prefijo:

```js
const altUrl = selection.file_path.includes('/Q-')
  ? selection.file_path.replace('/Q-', '/')
  : null;
```

### 3.4 Escaneo nocturno (ScannerService)

**Archivo:** `src/services/ScannerService.js`
**Horario:** 5:00 AM (configurable con `SCAN_CRON_SCHEDULE`)

El escaneo nocturno hace lo siguiente cada noche:
1. Se conecta por SFTP a Kraken.
2. Recorre el directorio de **ayer** en cada fuente Aware: `/media/tecnologia/STORAGE/GRABACIONES/{AWARE_X}/YYYY/MM/DD/`
3. Registra cada archivo nuevo en la tabla `recordings` con su ruta SFTP completa como `file_path`.
4. Fase de enriquecimiento: consulta PostgreSQL de cada Aware (vía túnel SSH) para obtener datos del agente, duración y proyecto.

Los archivos registrados por el scanner tienen `file_path` con formato de ruta SFTP:
```
/media/tecnologia/STORAGE/GRABACIONES/AWARE_30/2026/04/24/Q-13467929017-487910.WAV
```

### 3.5 Selección en tiempo real (RealtimeScanService)

**Archivo:** `src/services/RealtimeScanService.js`

Cuando un auditor quiere auditar una grabación del **día actual** (que todavía no pasó por el escaneo nocturno), `RealtimeScanService` consulta directamente el PostgreSQL de Aware vía túnel SSH para listar las llamadas del día. Al seleccionar una, construye una URL HTTP y la guarda como `file_path`:

```
https://10.255.255.30/audiofiles/2026/04/24/Q-13467929017-487910.WAV
```

Esto es distinto al `file_path` del escaneo nocturno (que es ruta SFTP). `AnalysisService` detecta el formato del `file_path` para saber qué mecanismo usar al descargar el audio:

```js
if (fs.existsSync(file_path))         → archivo local (Avaya, legacy)
else if (file_path.includes('zoom.'))  → descarga Zoom con OAuth
else if (file_path.startsWith('http')) → descarga HTTP de Aware (con fallback Q-/sin Q- + túnel)
else                                   → descarga SFTP desde Kraken
```

---

## 4. Zoom Phone

### ¿Por qué Zoom?

Algunos agentes de Obama y LV usan Zoom Phone para sus llamadas. Zoom es un sistema completamente separado de Aware; no tiene nada que ver con la infraestructura interna. VoxPro se conecta a la API REST de Zoom directamente desde internet.

### Autenticación

**Tipo:** Server-to-Server OAuth (no requiere login de usuario)
**Servicio:** `src/services/ZoomAuthService.js`

Zoom emite tokens de acceso que expiran cada hora. VoxPro los cachea en memoria y los renueva automáticamente 60 segundos antes de que venzan:

```js
// Flujo: POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id={id}
// Headers: Authorization: Basic {base64(clientId:clientSecret)}
// Respuesta: { access_token: "...", expires_in: 3600 }
```

**Variables de entorno necesarias:**
- `ZOOM_ACCOUNT_ID`
- `ZOOM_CLIENT_ID`
- `ZOOM_CLIENT_SECRET`

### Descarga de grabaciones

Las URLs de descarga de Zoom requieren autenticación Bearer:

```js
// ZoomAuthService.download(url)
await axios.get(url, {
  headers: { Authorization: `Bearer ${token}` },
  responseType: 'arraybuffer',
});
```

Las URLs tienen el formato: `https://file.zoom.us/recording/download/{id}?...`

### Escaneo de grabaciones Zoom

**Archivo:** `src/services/ZoomScannerService.js`
**Endpoint Zoom:** `GET /phone/recordings?from=YYYY-MM-DD&to=YYYY-MM-DD`

El escaneo Zoom ocurre en dos momentos:
- **Escaneo nocturno**: junto con el de Aware, escanea el día anterior.
- **Escaneo intradiario**: cada 30 minutos entre las 10am y las 9pm, para tener las grabaciones del día actual disponibles (a diferencia de Aware que solo se tiene en tiempo real).

### Fuentes Zoom en la base de datos

Hay dos fuentes Zoom configuradas en la tabla `aware_sources`:

| `folder_name` | Cliente | Descripción |
|---|---|---|
| `ZOOM_PHONE` | `obama` | Grabaciones Zoom de agentes Obama |
| `ZOOM_PHONE_LV` | `lv` | Grabaciones Zoom de agentes LV |

**Punto importante:** Zoom no sabe a qué cliente pertenece cada agente; solo devuelve el nombre y la extensión. VoxPro resuelve esto comparando la cédula del agente contra la tabla `agents` y los `proyecto_id` de las grabaciones Aware. Si un agente tiene grabaciones Aware con `proyecto_id` 34 o 35 (LV), sus grabaciones Zoom van a `ZOOM_PHONE_LV`. De lo contrario, van a `ZOOM_PHONE` (Obama).

### Resolución de identidad del agente Zoom

Zoom identifica a los agentes por nombre y extensión, no por cédula. Para cruzar con las grabaciones Aware (que usan cédula), VoxPro hace lo siguiente:

1. **Lookup directo**: busca la extensión Zoom en la tabla `agents` donde ya hay un mapeo `zoom_extension → cedula`.
2. **Auto-match fuzzy**: si no encuentra mapeo, compara el nombre Zoom contra todos los nombres de agentes en grabaciones Aware. Si hay coincidencia de ≥2 tokens y score ≥0.5, usa esa cédula y guarda el mapeo para el futuro.
3. **Fallback**: si no hay match, guarda el agente con `cedula = NULL`. El servicio `resolveUnmatchedAgents()` lo reintenta en cada scan futuro — cuando el agente aparezca en Aware, se resuelve automáticamente.

---

## 5. Flujo completo de una auditoría

### Caso A: grabación de día anterior (ya escaneada)

```
1. Escaneo nocturno (~5am)
   → ScannerService: SFTP a Kraken → encuentra archivos → inserta en recordings
                                                          (file_path = ruta SFTP)
   → AwareDBService: túnel SSH → PostgreSQL Aware → enriquece con datos de agente

2. Auditor selecciona grabación
   → AuditService: crea audit_selection con recording_id

3. Auditor solicita análisis
   → AnalysisService.analyzeSelection()
   → file_path empieza con '/'  → SFTPService: descarga desde Kraken
   → ffmpeg: convierte a opus 16kHz mono
   → GeminiService: transcribe + evalúa
   → Guarda en transcriptions + qa_evaluations
```

### Caso B: grabación del día actual (tiempo real)

```
1. Auditor consulta grabaciones del día
   → RealtimeScanService.getAgents() / getCallsByAgent()
   → túnel SSH → PostgreSQL Aware → lista llamadas del día

2. Auditor selecciona grabación
   → realtime.controller.selectCall()
   → inserta en recordings (file_path = URL HTTP de Aware)
   → inserta en audit_selections

3. Auditor solicita análisis
   → AnalysisService.analyzeSelection()
   → file_path empieza con 'https://'
   → Intento 1: downloadBuffer(url con Q-)        → puede retornar 404
   → Intento 2: downloadBuffer(url sin Q-)         → OK si es llamada directa
   → Intento 3: downloadBufferViaTunnel(url con Q-)
   → Intento 4: downloadBufferViaTunnel(url sin Q-)
   → Intento 5: SFTP desde Kraken (normalmente falla para hoy)
   → ffmpeg + Gemini + guardar resultados
```

### Caso C: grabación Zoom

```
1. Escaneo Zoom (nocturno o intradiario cada 30min)
   → ZoomScannerService.run()
   → ZoomAuthService.get('/phone/recordings') → API REST Zoom
   → Resuelve cédula del agente (tabla agents / fuzzy match)
   → inserta en recordings (file_path = download_url de Zoom)

2. Auditor selecciona y analiza (igual que Caso A/B)
   → AnalysisService.analyzeSelection()
   → file_path contiene 'zoom.us' o 'zoomgov.com'
   → ZoomAuthService.download(url) con Bearer token
   → ffmpeg + Gemini + guardar resultados
```

---

## 6. Variables de entorno requeridas

```env
# Base de datos MySQL de VoxPro
DB_HOST=
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=voxpro

# SSH / SFTP a Kraken (servidor puente)
AWARE_SSH_HOST=10.255.255.95
AWARE_SSH_PORT=22
AWARE_SSH_USER=tecnologia
AWARE_SSH_PASSWORD=           # usar uno u otro (password o key)
AWARE_SSH_KEY_PATH=           # ruta a llave privada SSH

# Ruta base de grabaciones en Kraken
AWARE_RECORDINGS_PATH=/media/tecnologia/STORAGE/GRABACIONES

# Credenciales de las bases de datos PostgreSQL de Aware (3 grupos por nivel de acceso)
AWARE_DB_USER_GROUP1=analista
AWARE_DB_PASS_GROUP1=
AWARE_DB_USER_GROUP2=analista
AWARE_DB_PASS_GROUP2=
AWARE_DB_USER_GROUP3=analista
AWARE_DB_PASS_GROUP3=

# Google Gemini (transcripción y evaluación)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-pro

# Zoom Server-to-Server OAuth
ZOOM_ACCOUNT_ID=
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=

# JWT
JWT_SECRET=
JWT_EXPIRES_IN=8h

# Otros
PORT=3000
NODE_ENV=production
CORS_ORIGIN=http://localhost:5173
SCAN_CRON_SCHEDULE=0 2 * * *
```

---

## 7. Errores comunes y su causa real

### `HTTP 404` al descargar audio de Aware

**Causa más probable:** la URL fue construida con prefijo `Q-` pero la grabación es una llamada directa (sin cola) cuyo archivo no lleva ese prefijo.

**Ejemplo:**
- URL generada: `https://10.255.255.30/audiofiles/2026/04/24/Q-13467640147-950459.WAV`
- Archivo real:  `https://10.255.255.30/audiofiles/2026/04/24/13467640147-950459.WAV`

**Solución en código:** `AnalysisService` intenta automáticamente la URL sin `Q-` si la primera falla.

---

### `503 Service Unavailable` al analizar grabación del día actual

**Causa:** todos los métodos de descarga fallaron. Puede ser porque:
- La grabación es muy reciente y aún no existe el archivo en el servidor Aware.
- El servidor Aware específico no está disponible.
- El tunnel SSH a Kraken falló.

**Para diagnosticar:** revisar `logs/voxpro-{fecha}.log`. Los mensajes `WARN` muestran exactamente cuál método falló y con qué error.

---

### `SFTP: No such file` al analizar grabación del día actual

**Causa esperada y normal:** las grabaciones del día actual no existen todavía en el almacenamiento de Kraken. El escaneo nocturno las copia aproximadamente a las 5am del día siguiente. El SFTP a Kraken es el último fallback y es normal que falle para grabaciones del día.

---

### `SFTP: No such file` al analizar grabación de día anterior

**Causa:** el escaneo nocturno no encontró el archivo ese día. Puede ser porque:
- Kraken no estaba disponible durante el escaneo.
- La carpeta de la fuente Aware en Kraken no existía o estaba vacía ese día.

**Solución:** se puede lanzar un re-escaneo manual para esa fecha desde el endpoint de administración, o verificar el directorio en Kraken vía SFTP.

---

### `TypeError: Converting circular structure to JSON` en los logs de error

**Causa:** el logger de Winston intenta serializar un objeto HTTP/TLS (como un `Agent` de HTTPS o un `TLSSocket`) usando `JSON.stringify`. Ocurre cuando se pasa el objeto de error directamente al logger.

**Impacto:** solo afecta el logging, no la funcionalidad. La solicitud puede haber terminado correctamente.

---

### Agente Zoom no tiene cédula (`agent_id = extensión`)

**Causa:** el agente aún no aparece en las grabaciones Aware (no se ha hecho el auto-match fuzzy todavía) y no hay mapeo manual en la tabla `agents`.

**Solución automática:** en el próximo escaneo Zoom, `resolveUnmatchedAgents()` reintenta el match. Una vez que el agente tenga grabaciones Aware, se resuelve solo.

---

*Última actualización: 2026-04-24*
