const ExcelJS = require('exceljs');
const db = require('../database/connection');

// Excel no admite más de 32.767 caracteres por celda: una transcripción más
// larga sigue en las columnas "Transcripción (cont.)" en vez de cortarse.
const CELL_MAX = 32000;
const EXTRA_COLS = 2;

const CLIENT_LABELS = { claro_tyt: 'Claro TyT', claro_hogar: 'Claro Hogar' };

// Caracteres de control que no caben en el XML del .xlsx (dejan el archivo corrupto).
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function baseQuery({ clientCodes, dateFrom, dateTo }) {
  return db('sofia_continuation_audits')
    .whereIn('client_code', clientCodes)
    .where('status', 'scored')
    .whereBetween('fecha', [dateFrom, dateTo]);
}

function toExcelDate(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** 'YYYY-MM-DD HH:MM:SS' (hora de la base) → Date que Excel muestra con esa misma hora. */
function toExcelDateTime(ymdHms) {
  if (!ymdHms) return null;
  const [ymd, hms = '00:00:00'] = ymdHms.split(' ');
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mi, ss] = hms.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh || 0, mi || 0, ss || 0));
}

function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function styleHeader(header) {
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
}

function splitText(text) {
  const clean = String(text || '').replace(INVALID_XML, '').replace(/\r\n/g, '\n').trim();
  const parts = [];
  for (let i = 0; i < clean.length && parts.length < EXTRA_COLS + 1; i += CELL_MAX) parts.push(clean.slice(i, i + CELL_MAX));
  return parts;
}

class ContinuationExportService {
  async count(filters) {
    const [{ c }] = await baseQuery(filters).count('* as c');
    return Number(c);
  }

  /**
   * Escribe directo en `stream` (la respuesta HTTP) un .xlsx con una fila por
   * continuación calificada en el rango: agente, fecha, duración, tipificación
   * y transcripción Agente/Cliente. Se lee la base por partes (stream) — un mes
   * de TyT son ~40 MB de transcripciones.
   */
  async writeXlsx(stream, { clientCodes, dateFrom, dateTo }) {
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
    wb.creator = 'VoxPro';

    const ws = wb.addWorksheet('Continuidad', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Agente', key: 'agente', width: 34 },
      { header: 'Cédula', key: 'cedula', width: 14 },
      { header: 'Fecha', key: 'fecha', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Hora', key: 'hora', width: 10 },
      { header: 'Duración', key: 'duracion', width: 10, style: { numFmt: '[m]:ss' } },
      { header: 'Tipificación del agente', key: 'tipificacion', width: 26 },
      { header: 'Transcripción (Agente / Cliente)', key: 't0', width: 110 },
      ...Array.from({ length: EXTRA_COLS }, (_, i) => ({ header: 'Transcripción (cont.)', key: `t${i + 1}`, width: 60 })),
    ];

    const header = ws.getRow(1);
    styleHeader(header);
    ws.autoFilter = { from: 'A1', to: 'F1' };
    header.commit();

    const top = { vertical: 'top' };
    const query = baseQuery({ clientCodes, dateFrom, dateTo })
      .orderBy('fecha', 'asc')
      .orderBy('hora', 'asc')
      .select(
        'agente_nombre', 'agente_id', db.raw("DATE_FORMAT(fecha, '%Y-%m-%d') as fecha"), 'hora', 'duracion',
        'nomenclatura_nombre', 'nomenclatura_id', 'transcription',
      );

    let total = 0;
    for await (const r of query.stream()) {
      const parts = splitText(r.transcription);
      const row = ws.addRow({
        agente: r.agente_nombre || '',
        cedula: r.agente_id || '',
        fecha: toExcelDate(r.fecha),
        hora: r.hora ? String(r.hora).slice(0, 8) : '',
        duracion: r.duracion != null ? r.duracion / 86400 : null,
        tipificacion: r.nomenclatura_nombre || r.nomenclatura_id || '',
        ...Object.fromEntries(parts.map((p, i) => [`t${i}`, p])),
      });
      row.eachCell((cell, col) => { cell.alignment = col >= 7 ? { ...top, wrapText: true } : top; });
      row.commit();
      total++;
    }
    ws.commit();

    const info = wb.addWorksheet('Información');
    info.columns = [{ width: 24 }, { width: 50 }];
    [
      ['Reporte', 'Auditorías con continuidad (asesor humano)'],
      ['Campaña', clientCodes.map((c) => CLIENT_LABELS[c] || c).join(', ')],
      ['Desde', toExcelDate(dateFrom)],
      ['Hasta', toExcelDate(dateTo)],
      ['Auditorías', total],
      ['Generado', new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })],
    ].forEach(([k, v]) => {
      const row = info.addRow([k, v]);
      row.getCell(1).font = { bold: true };
      if (v instanceof Date) row.getCell(2).numFmt = 'dd/mm/yyyy';
      row.getCell(2).alignment = { horizontal: 'left' };
      row.commit();
    });
    info.commit();

    await wb.commit();
    return total;
  }

  /**
   * .xlsx de "Calificación de agentes" de una semana (lunes `weekStart` a
   * domingo): hoja "Detalle" con una fila por calificación — con la cantidad
   * y el promedio semanal del agente repetidos en cada fila para poder
   * filtrar — y hoja "Resumen" con una fila por agente. Mismo universo que
   * SofiaHumanService.getAgentWeekly. La fecha de monitoreo es updated_at:
   * la última escritura de _upsertContinuation es la que deja la fila en 'scored'.
   */
  async writeAgentWeeklyXlsx(stream, { clientCodes, weekStart }) {
    const weekEnd = addDays(weekStart, 6);
    const rows = await baseQuery({ clientCodes, dateFrom: weekStart, dateTo: weekEnd })
      .whereNotNull('agente_id')
      .orderBy('fecha', 'asc')
      .orderBy('hora', 'asc')
      .select(
        'agente_id', 'agente_nombre', 'score', 'hora',
        db.raw("DATE_FORMAT(fecha, '%Y-%m-%d') as fecha"),
        db.raw("DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') as monitoreo"),
        db.raw("DATE_FORMAT(delivered_at, '%Y-%m-%d %H:%i:%s') as feedback"),
      );

    const byAgent = new Map();
    for (const r of rows) {
      if (!byAgent.has(r.agente_id)) byAgent.set(r.agente_id, { cedula: r.agente_id, nombre: '', audits: [] });
      const agent = byAgent.get(r.agente_id);
      if (r.agente_nombre) agent.nombre = r.agente_nombre;
      agent.audits.push(r);
    }
    const agents = [...byAgent.values()]
      .map((a) => {
        const scores = a.audits.map((r) => Number(r.score));
        const promedio = Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
        return { ...a, promedio, minimo: Math.min(...scores), maximo: Math.max(...scores) };
      })
      .sort((a, b) => (a.nombre || a.cedula).localeCompare(b.nombre || b.cedula, 'es'));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'VoxPro';
    const dateTimeFmt = 'dd/mm/yyyy hh:mm';

    const detalle = wb.addWorksheet('Detalle', { views: [{ state: 'frozen', ySplit: 1 }] });
    detalle.columns = [
      { header: 'Cédula', key: 'cedula', width: 14 },
      { header: 'Nombre', key: 'nombre', width: 34 },
      { header: 'Cantidad de calificaciones', key: 'cantidad', width: 16 },
      { header: 'Puntaje', key: 'puntaje', width: 10 },
      { header: 'Promedio semana', key: 'promedio', width: 12, style: { numFmt: '0.0' } },
      { header: 'Fecha de monitoreo', key: 'monitoreo', width: 18, style: { numFmt: dateTimeFmt } },
      { header: 'Fecha de la llamada', key: 'llamada', width: 18, style: { numFmt: dateTimeFmt } },
      { header: 'Fecha de feedback', key: 'feedback', width: 18, style: { numFmt: dateTimeFmt } },
    ];
    styleHeader(detalle.getRow(1));
    detalle.autoFilter = { from: 'A1', to: 'H1' };
    for (const a of agents) {
      for (const r of a.audits) {
        detalle.addRow({
          cedula: a.cedula,
          nombre: a.nombre,
          cantidad: a.audits.length,
          puntaje: Number(r.score),
          promedio: a.promedio,
          monitoreo: toExcelDateTime(r.monitoreo),
          llamada: toExcelDateTime(`${r.fecha} ${String(r.hora || '').slice(0, 8)}`),
          feedback: r.feedback ? toExcelDateTime(r.feedback) : 'Sin feedback',
        });
      }
    }

    const resumen = wb.addWorksheet('Resumen', { views: [{ state: 'frozen', ySplit: 1 }] });
    resumen.columns = [
      { header: 'Cédula', key: 'cedula', width: 14 },
      { header: 'Nombre', key: 'nombre', width: 34 },
      { header: 'Cantidad de calificaciones', key: 'cantidad', width: 16 },
      { header: 'Promedio semana', key: 'promedio', width: 12, style: { numFmt: '0.0' } },
      { header: 'Mínimo', key: 'minimo', width: 10 },
      { header: 'Máximo', key: 'maximo', width: 10 },
      { header: 'Feedbacks entregados', key: 'feedbacks', width: 14 },
    ];
    styleHeader(resumen.getRow(1));
    resumen.autoFilter = { from: 'A1', to: 'G1' };
    for (const a of agents) {
      resumen.addRow({
        cedula: a.cedula,
        nombre: a.nombre,
        cantidad: a.audits.length,
        promedio: a.promedio,
        minimo: a.minimo,
        maximo: a.maximo,
        feedbacks: a.audits.filter((r) => r.feedback).length,
      });
    }

    const info = wb.addWorksheet('Información');
    info.columns = [{ width: 24 }, { width: 50 }];
    [
      ['Reporte', 'Calificación de agentes (continuidad SOFIA)'],
      ['Campaña', clientCodes.map((c) => CLIENT_LABELS[c] || c).join(', ')],
      ['Semana desde', toExcelDate(weekStart)],
      ['Semana hasta', toExcelDate(weekEnd)],
      ['Agentes', agents.length],
      ['Calificaciones', rows.length],
      ['Generado', new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })],
    ].forEach(([k, v]) => {
      const row = info.addRow([k, v]);
      row.getCell(1).font = { bold: true };
      if (v instanceof Date) row.getCell(2).numFmt = 'dd/mm/yyyy';
      row.getCell(2).alignment = { horizontal: 'left' };
    });

    await wb.xlsx.write(stream);
    return rows.length;
  }
}

module.exports = new ContinuationExportService();
