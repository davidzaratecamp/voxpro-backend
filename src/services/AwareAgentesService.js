const { Client: PGClient } = require('pg');
const sources = require('../config/sources');
const AwareDBService = require('./AwareDBService');
const logger = require('../utils/logger');

/**
 * Usuarios ACTIVOS de cada servidor Aware (cédula, nombre, rol), para el cruce de empleados del
 * Gestor Técnico (pestaña "Empleados activos" del técnico de inventario).
 *
 * El Gestor no alcanza la red privada de Aware (10.255.255.x); VoxPro sí, por el túnel SSH de
 * Kraken. Por eso el Gestor le pide la lista a VoxPro (routes/gestorAware.routes.js).
 *
 * - Esquema `standard` → tabla `empleado`: cédula = empleado_rut, activo = empleado_activo = 1
 *   y empleado_eliminado distinto de 1.
 * - Esquema `awareccm` (Claro WCB) → tabla `usuario`: cédula = user_id, activo = activo = 1 y
 *   eliminado distinto de 1.
 * - Nunca se leen las columnas de contraseña (empleado_pass / user_pass) ni datos de contacto.
 * - Varias entradas de sources.js comparten servidor (AWARE_30 = LV + Obama): se consulta una vez
 *   por servidor y se etiqueta con todos sus clientes.
 * - Caché en memoria de 10 minutos; las peticiones simultáneas comparten la misma consulta.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_FUENTE_MS = 60 * 1000;

const SQL_STANDARD = `
  SELECT empleado_rut::text AS cedula, TRIM(empleado_name) AS nombre, rol_id
    FROM empleado
   WHERE empleado_activo = 1 AND COALESCE(empleado_eliminado, 0) <> 1`;

const SQL_AWARECCM = `
  SELECT TRIM(user_id) AS cedula, TRIM(user_fullname) AS nombre, rol_id
    FROM usuario
   WHERE activo = 1 AND COALESCE(eliminado, 0) <> 1`;

let cache = null; // { generadoEn, expira, datos }
let enCurso = null;

/** Una entrada por servidor (host + base), con los nombres de todos los clientes que lo usan. */
function servidoresUnicos() {
  const porServidor = new Map();
  for (const s of sources) {
    const clave = `${s.db.host}:${s.db.port}/${s.db.database}`;
    const actual = porServidor.get(clave);
    if (actual) {
      if (!actual.clientes.includes(s.clientName)) actual.clientes.push(s.clientName);
    } else {
      porServidor.set(clave, { fuente: s, clientes: [s.clientName] });
    }
  }
  return [...porServidor.values()].map(({ fuente, clientes }) => ({
    folder: fuente.folder,
    nombre: `${clientes.join(' / ')} (${fuente.folder})`,
    fuente,
  }));
}

function conTimeout(promesa, ms, etiqueta) {
  let timer;
  return Promise.race([
    promesa,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${etiqueta}: sin respuesta en ${ms / 1000} s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function consultarServidor({ folder, nombre, fuente }) {
  let tunnel = null;
  let pgClient = null;
  try {
    tunnel = await AwareDBService._openTunnel(fuente.db);
    pgClient = new PGClient({
      host: '127.0.0.1',
      port: tunnel.localPort,
      database: fuente.db.database,
      user: fuente.db.user,
      password: fuente.db.password,
      statement_timeout: 20000,
      connectionTimeoutMillis: 15000,
    });
    await pgClient.connect();
    await pgClient.query('SET default_transaction_read_only = on');
    const { rows } = await pgClient.query(fuente.schema === 'awareccm' ? SQL_AWARECCM : SQL_STANDARD);
    return {
      folder,
      nombre,
      usuarios: rows
        .filter((r) => r.cedula)
        .map((r) => ({ cedula: String(r.cedula).trim(), nombre: r.nombre || '', rol_id: r.rol_id })),
    };
  } finally {
    if (pgClient) await pgClient.end().catch(() => {});
    if (tunnel) {
      tunnel.localServer.close();
      tunnel.sshClient.end();
    }
  }
}

async function cargar() {
  const servidores = servidoresUnicos();
  const resultados = await Promise.allSettled(
    servidores.map((s) => conTimeout(consultarServidor(s), TIMEOUT_FUENTE_MS, s.folder)),
  );

  const fuentes = [];
  const agentes = [];
  resultados.forEach((r, i) => {
    const { folder, nombre } = servidores[i];
    if (r.status === 'fulfilled') {
      fuentes.push({ folder, nombre, ok: true, activos: r.value.usuarios.length });
      for (const u of r.value.usuarios) agentes.push({ ...u, folder, campania: nombre });
    } else {
      logger.error(`AwareAgentes ${folder}: ${r.reason?.message || r.reason}`);
      fuentes.push({ folder, nombre, ok: false, error: r.reason?.message || 'Error consultando el servidor' });
    }
  });

  return { generadoEn: new Date().toISOString(), fuentes, agentes };
}

/**
 * @param {{ refrescar?: boolean }} [opts] refrescar: ignora la caché (el botón "Actualizar" del Gestor).
 */
async function obtenerAgentesActivos({ refrescar = false } = {}) {
  if (!refrescar && cache && cache.expira > Date.now()) return cache.datos;
  if (enCurso) return enCurso;
  enCurso = cargar()
    .then((datos) => {
      // Si todas las fuentes fallaron, no se guarda en caché: el próximo intento vuelve a consultar.
      if (datos.fuentes.some((f) => f.ok)) cache = { expira: Date.now() + CACHE_TTL_MS, datos };
      return datos;
    })
    .finally(() => {
      enCurso = null;
    });
  return enCurso;
}

module.exports = { obtenerAgentesActivos, servidoresUnicos };
