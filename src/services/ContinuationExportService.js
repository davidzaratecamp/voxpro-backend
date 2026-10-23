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
    header.height = 22;
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
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
}

module.exports = new ContinuationExportService();
