const path = require('path');
const crypto = require('crypto');
const db = require('../database/connection');
const config = require('../config');
const logger = require('../utils/logger');
const parseFilename = require('../utils/parseFilename');
const SFTPService = require('./SFTPService');
const AwareDBService = require('./AwareDBService');
const AWARE_SOURCES = require('../config/sources');

// Carpetas internas de Aware que NO contienen grabaciones del día
const IGNORED_DIRS = new Set([
  'audio_custom',
  'audiocustom',
  'old_audio_custom',
  'consolidados',
  'temp',
]);

class ScannerService {
  constructor() {
    this.basePath = config.aware.recordingsPath;
    this.validExtensions = new Set(
      config.aware.extensions.map((e) => e.toLowerCase())
    );
    this.batchSize = config.scan.batchSize;
  }

  /**
   * Ejecuta un escaneo conectándose por SFTP al servidor Aware.
   * Detecta archivos nuevos y los registra en MySQL.
   *
   * @param {object} options
   * @param {string} options.targetDate - Fecha YYYY-MM-DD (default: ayer)
   * @param {boolean} options.fullScan  - Escanear TODAS las fechas
   * @returns {object} Resumen del escaneo
   */
  async run({ targetDate, fullScan = false } = {}) {
    const job = await this._createJob();
    const summary = { found: 0, inserted: 0, skipped: 0, errors: 0 };
    const sftp = new SFTPService();

    try {
      await sftp.connect();

      const sources = await db('aware_sources').where({ active: true });

      if (sources.length === 0) {
        logger.warn('No hay fuentes Aware activas configuradas');
        await this._completeJob(job.id, summary);
        await sftp.disconnect();
        return summary;
      }

      logger.info(`Iniciando escaneo de ${sources.length} fuentes`, {
        targetDate: targetDate || 'ayer',
        fullScan,
      });

      for (const source of sources) {
        try {
          const sourceSummary = await this._scanSource(sftp, source, {
            targetDate,
            fullScan,
          });
          summary.found += sourceSummary.found;
          summary.inserted += sourceSummary.inserted;
          summary.skipped += sourceSummary.skipped;
          summary.errors += sourceSummary.errors;
        } catch (err) {
          logger.error(`Error escaneando ${source.folder_name}`, err);
          summary.errors++;
        }
      }

      // Fase 2: Enriquecer grabaciones nuevas con datos de agente
      await this._enrichNewRecordings();

      await this._completeJob(job.id, summary);
      logger.info('Escaneo completado', summary);
      return summary;
    } catch (err) {
      await this._failJob(job.id, err.message);
      logger.error('Escaneo fallido', err);
      throw err;
    } finally {
      await sftp.disconnect();
    }
  }

  /**
   * Escanea una fuente Aware individual vía SFTP.
   */
  async _scanSource(sftp, source, { targetDate, fullScan }) {
    const sourceDir = path.posix.join(this.basePath, source.folder_name);
    const result = { found: 0, inserted: 0, skipped: 0, errors: 0 };

    const exists = await sftp.exists(sourceDir);
    if (!exists) {
      logger.warn(`Carpeta remota no encontrada: ${sourceDir}`);
      return result;
    }

    let files; // Array de { remotePath, size }

    if (fullScan) {
      files = await this._walkRemoteDirectory(sftp, sourceDir, 0);
    } else {
      // Solo escanear la fecha objetivo (default: ayer)
      const date = targetDate ? new Date(targetDate + 'T12:00:00') : this._yesterday();
      const year = date.getFullYear().toString();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');

      const dayDir = path.posix.join(sourceDir, year, month, day);
      const dayExists = await sftp.exists(dayDir);
      if (!dayExists) {
        logger.info(`Sin directorio: ${source.folder_name}/${year}/${month}/${day}`);
        return result;
      }
      files = await this._listRemoteAudioFiles(sftp, dayDir);
    }

    result.found = files.length;

    if (files.length === 0) return result;

    logger.info(`${source.folder_name}: ${files.length} archivos encontrados`);

    // Procesar en lotes
    for (let i = 0; i < files.length; i += this.batchSize) {
      const batch = files.slice(i, i + this.batchSize);
      const batchResult = await this._insertBatch(batch, source);
      result.inserted += batchResult.inserted;
      result.skipped += batchResult.skipped;
      result.errors += batchResult.errors;
    }

    return result;
  }

  /**
   * Inserta un lote de archivos en la DB, evitando duplicados.
   */
  _hashPath(filePath) {
    return crypto.createHash('sha256').update(filePath).digest('hex');
  }

  async _insertBatch(files, source) {
    const result = { inserted: 0, skipped: 0, errors: 0 };

    // Consultar cuáles ya existen por hash del path
    const hashes = files.map((f) => this._hashPath(f.remotePath));
    const existingHashes = new Set(
      (
        await db('recordings')
          .whereIn('file_path_hash', hashes)
          .select('file_path_hash')
      ).map((r) => r.file_path_hash)
    );

    const newRecords = [];

    for (const file of files) {
      const pathHash = this._hashPath(file.remotePath);
      if (existingHashes.has(pathHash)) {
        result.skipped++;
        continue;
      }

      try {
        const fileName = path.posix.basename(file.remotePath);
        const fileDate = this._extractDateFromPath(file.remotePath);
        const meta = parseFilename(fileName);

        newRecords.push({
          aware_source_id: source.id,
          file_name: fileName,
          file_path: file.remotePath,
          file_path_hash: pathHash,
          file_size: file.size,
          file_date: fileDate,
          call_phone: meta.phone,
          call_id: meta.callId,
          is_queue_call: meta.isQueueCall,
          status: 'pending',
        });
      } catch (err) {
        logger.error(`Error procesando: ${file.remotePath}`, err);
        result.errors++;
      }
    }

    if (newRecords.length > 0) {
      // Insertar en sub-lotes de 100
      for (let i = 0; i < newRecords.length; i += 100) {
        const subBatch = newRecords.slice(i, i + 100);
        try {
          await db('recordings').insert(subBatch);
          result.inserted += subBatch.length;
        } catch {
          // Si falla el batch, insertar uno por uno
          for (const record of subBatch) {
            try {
              await db('recordings').insert(record);
              result.inserted++;
            } catch (singleErr) {
              if (singleErr.code === 'ER_DUP_ENTRY') {
                result.skipped++;
              } else {
                logger.error(`Error insertando: ${record.file_path}`, singleErr);
                result.errors++;
              }
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Recorre recursivamente un directorio remoto vía SFTP.
   * Solo baja por estructura YYYY/MM/DD, ignora carpetas internas de Aware.
   *
   * @returns {Array<{remotePath: string, size: number}>}
   */
  async _walkRemoteDirectory(sftp, dir, depth) {
    const results = [];

    const entries = await sftp.listFiles(dir);
    // Archivos de audio en este nivel
    for (const entry of entries) {
      const ext = path.posix.extname(entry.name).toLowerCase();
      if (this.validExtensions.has(ext)) {
        results.push({
          remotePath: path.posix.join(dir, entry.name),
          size: entry.size,
        });
      }
    }

    // Subdirectorios (max 3 niveles: YYYY/MM/DD)
    if (depth < 3) {
      const subDirs = await sftp.listDirs(dir);
      for (const subDir of subDirs) {
        if (IGNORED_DIRS.has(subDir.toLowerCase())) continue;
        const subPath = path.posix.join(dir, subDir);
        const subResults = await this._walkRemoteDirectory(sftp, subPath, depth + 1);
        results.push(...subResults);
      }
    }

    return results;
  }

  /**
   * Lista archivos de audio en un directorio remoto (sin recursión).
   */
  async _listRemoteAudioFiles(sftp, dir) {
    const entries = await sftp.listFiles(dir);
    return entries
      .filter((entry) => {
        const ext = path.posix.extname(entry.name).toLowerCase();
        return this.validExtensions.has(ext);
      })
      .map((entry) => ({
        remotePath: path.posix.join(dir, entry.name),
        size: entry.size,
      }));
  }

  /**
   * Extrae la fecha del path remoto.
   * Esperado: .../AWARE_X/YYYY/MM/DD/archivo.WAV
   */
  _extractDateFromPath(filePath) {
    const parts = filePath.split('/');
    for (let i = parts.length - 2; i >= 2; i--) {
      const day = parts[i];
      const month = parts[i - 1];
      const year = parts[i - 2];

      if (/^\d{4}$/.test(year) && /^\d{2}$/.test(month) && /^\d{2}$/.test(day)) {
        const dateStr = `${year}-${month}-${day}`;
        const parsed = new Date(dateStr + 'T12:00:00');
        if (!isNaN(parsed.getTime())) return dateStr;
      }
    }
    return null;
  }

  /**
   * Escanea todos los días desde el último escaneo exitoso hasta ayer.
   * Si nunca se ha escaneado, solo escanea ayer.
   * Esto previene que se pierdan grabaciones si el scheduler falla un día.
   *
   * @returns {object} Resumen acumulado de todos los escaneos
   */
  async runCatchUp() {
    const yesterday = this._yesterday();
    const yesterdayStr = this._formatDate(yesterday);

    // Buscar la fecha más reciente escaneada exitosamente
    const lastJob = await db('processing_jobs')
      .where({ job_type: 'scan', status: 'completed' })
      .where('files_new', '>', 0)
      .orderBy('completed_at', 'desc')
      .select('completed_at')
      .first();

    if (!lastJob) {
      // Nunca se ha escaneado con éxito, solo escanear ayer
      logger.info('Sin escaneos previos, escaneando solo ayer');
      return this.run();
    }

    // Calcular desde qué fecha debemos escanear
    const lastScanDate = new Date(lastJob.completed_at);
    // El último escaneo exitoso cubrió su fecha objetivo,
    // así que empezamos desde el día siguiente al escaneo
    const startDate = new Date(lastScanDate);
    startDate.setDate(startDate.getDate());
    startDate.setHours(0, 0, 0, 0);

    // Recolectar todas las fechas que necesitan escaneo
    const datesToScan = [];
    const current = new Date(startDate);
    while (this._formatDate(current) <= yesterdayStr) {
      datesToScan.push(this._formatDate(current));
      current.setDate(current.getDate() + 1);
    }

    // Asegurar que ayer siempre esté incluido
    if (!datesToScan.includes(yesterdayStr)) {
      datesToScan.push(yesterdayStr);
    }

    // Eliminar duplicados y ya escaneados (verificar en DB)
    const uniqueDates = [...new Set(datesToScan)];

    if (uniqueDates.length <= 1) {
      // Solo ayer, comportamiento normal
      return this.run();
    }

    logger.info(`Catch-up: escaneando ${uniqueDates.length} días: ${uniqueDates.join(', ')}`);

    const totalSummary = { found: 0, inserted: 0, skipped: 0, errors: 0, daysScanned: 0 };

    for (const dateStr of uniqueDates) {
      try {
        logger.info(`Catch-up: escaneando ${dateStr}`);
        const result = await this.run({ targetDate: dateStr });
        totalSummary.found += result.found;
        totalSummary.inserted += result.inserted;
        totalSummary.skipped += result.skipped;
        totalSummary.errors += result.errors;
        totalSummary.daysScanned++;
      } catch (err) {
        logger.error(`Catch-up: error escaneando ${dateStr}`, err);
        totalSummary.errors++;
      }
    }

    logger.info('Catch-up completado', totalSummary);
    return totalSummary;
  }

  _formatDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  _yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  }

  async _createJob() {
    const [id] = await db('processing_jobs').insert({
      job_type: 'scan',
      status: 'running',
    });
    return { id };
  }

  async _completeJob(jobId, summary) {
    await db('processing_jobs').where({ id: jobId }).update({
      status: 'completed',
      completed_at: db.fn.now(),
      files_found: summary.found,
      files_new: summary.inserted,
      files_error: summary.errors,
    });
  }

  async _failJob(jobId, errorMessage) {
    await db('processing_jobs').where({ id: jobId }).update({
      status: 'failed',
      completed_at: db.fn.now(),
      error_message: errorMessage,
    });
  }

  /**
   * Enriquece grabaciones que aún no tienen datos de agente.
   * Consulta cada servidor Aware vía túnel SSH por Kraken.
   */
  /**
   * Elimina grabaciones que no fueron seleccionadas para auditoría.
   * Conserva solo las que tienen una audit_selection asociada.
   */
  async cleanupUnselected() {
    const result = await db('recordings')
      .whereNotIn('id', db('audit_selections').select('recording_id'))
      .del();

    logger.info(`Limpieza: ${result} grabaciones no seleccionadas eliminadas`);
    return { deleted: result };
  }

  async _enrichNewRecordings() {
    // Obtener grabaciones sin enriquecer, agrupadas por fuente
    const unenriched = await db('recordings as r')
      .join('aware_sources as s', 'r.aware_source_id', 's.id')
      .where('r.agent_enriched', false)
      .whereNotNull('r.call_id')
      .select('r.id', 'r.call_id', 'r.file_date', 's.folder_name');

    if (unenriched.length === 0) {
      logger.info('Sin grabaciones para enriquecer');
      return;
    }

    logger.info(`${unenriched.length} grabaciones pendientes de enriquecer`);

    // Agrupar por folder
    const byFolder = {};
    for (const rec of unenriched) {
      if (!byFolder[rec.folder_name]) byFolder[rec.folder_name] = [];
      byFolder[rec.folder_name].push(rec);
    }

    for (const [folder, recs] of Object.entries(byFolder)) {
      const sourceConfig = AWARE_SOURCES.find((s) => s.folder === folder);
      if (!sourceConfig) {
        logger.warn(`Sin config de DB para ${folder}, marcando como enriquecido`);
        const ids = recs.map((r) => r.id);
        await db('recordings').whereIn('id', ids).update({ agent_enriched: true });
        continue;
      }

      try {
        // Procesar en lotes de 2000 para no sobrecargar la consulta PG
        for (let i = 0; i < recs.length; i += 2000) {
          const batch = recs.slice(i, i + 2000);
          const agentMap = await AwareDBService.enrichRecordings(sourceConfig, batch);

          // IDs con datos de agente → update con datos
          const withData = [];
          const withoutData = [];
          for (const rec of batch) {
            const agentData = agentMap.get(String(rec.call_id));
            if (agentData) {
              withData.push({ id: rec.id, ...agentData });
            } else {
              withoutData.push(rec.id);
            }
          }

          // Marcar los sin datos en un solo update
          if (withoutData.length > 0) {
            await db('recordings').whereIn('id', withoutData).update({ agent_enriched: true });
          }

          // Los con datos se actualizan individualmente (cada uno tiene datos distintos)
          for (const rec of withData) {
            const updateData = {
              agent_enriched: true,
              agent_id: rec.agent_id,
              agent_name: rec.agent_name,
              agent_extension: rec.agent_extension,
              call_duration: rec.call_duration,
            };
            if (rec.hangup_by) {
              updateData.hangup_by = rec.hangup_by;
            }
            if (rec.proyecto_id != null) {
              updateData.proyecto_id = rec.proyecto_id;
            }
            await db('recordings').where({ id: rec.id }).update(updateData);
          }

          logger.info(`${folder} lote ${Math.floor(i / 2000) + 1}: ${withData.length}/${batch.length} con agente`);
        }

        logger.info(`Enriquecido ${folder}: ${recs.length} grabaciones`);
      } catch (err) {
        logger.error(`Error enriqueciendo ${folder}`, err);
      }
    }
  }
}

module.exports = new ScannerService();
