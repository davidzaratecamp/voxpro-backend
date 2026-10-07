const db = require('../database/connection');
const logger = require('../utils/logger');
const { GROUPS, costUsd } = require('../config/geminiBilling');

/**
 * Registro y resumen del consumo de Gemini por campaña (grupo de facturación).
 * Registrar nunca debe romper un análisis: si falla la escritura, solo se loguea.
 */
class GeminiUsageService {
  async record({ group, campaign = null, flow, model, usage }) {
    if (!usage) return;
    try {
      const c = costUsd(model, usage);
      await db('gemini_usage').insert({
        billing_group: group,
        campaign,
        flow,
        model,
        text_tokens: c.textIn,
        audio_tokens: c.audioIn,
        output_tokens: c.output,
        cost_usd: c.usd.toFixed(6),
      });
    } catch (err) {
      logger.warn('GeminiUsage: no se pudo registrar el consumo', { message: err.message });
    }
  }

  /** Gasto de cada grupo desde el inicio de su presupuesto, con desglose por flujo y por día. */
  async summary() {
    const budgets = await db('gemini_budgets').select('*');
    const byGroup = new Map(budgets.map((b) => [b.billing_group, b]));
    const result = [];

    for (const [key, cfg] of Object.entries(GROUPS)) {
      const b = byGroup.get(key);
      const since = b ? b.start_date : null;
      const base = () => {
        const q = db('gemini_usage').where('billing_group', key);
        if (since) q.where('created_at', '>=', since);
        return q;
      };
      const [tot] = await base().select(
        db.raw('COUNT(*) AS analisis'),
        db.raw('COALESCE(SUM(cost_usd), 0) AS usd'),
        db.raw('MIN(created_at) AS desde'),
        db.raw('MAX(created_at) AS hasta')
      );
      const porFlujo = await base().groupBy('flow').select('flow', db.raw('COUNT(*) AS analisis'), db.raw('SUM(cost_usd) AS usd')).orderBy('usd', 'desc');
      const porDia = await base()
        .groupByRaw("DATE_FORMAT(created_at, '%Y-%m-%d')")
        .select(db.raw("DATE_FORMAT(created_at, '%Y-%m-%d') AS dia"), db.raw('SUM(cost_usd) AS usd'))
        .orderBy('dia');

      const copPerUsd = b ? Number(b.cop_per_usd) : null;
      const usd = Number(tot.usd);
      const gastadoCop = copPerUsd ? usd * copPerUsd : null;
      const budgetCop = b ? Number(b.budget_cop) : null;

      // Proyección: promedio diario de los días con consumo → días que quedan.
      const diasConConsumo = porDia.length;
      const promedioDiaCop = copPerUsd && diasConConsumo ? gastadoCop / diasConConsumo : null;
      const restanteCop = budgetCop != null ? budgetCop - gastadoCop : null;

      result.push({
        group: key,
        label: cfg.label,
        clave_propia: !!process.env[cfg.envKey] && key !== 'general',
        presupuesto: b
          ? { budget_cop: budgetCop, start_date: b.start_date, cop_per_usd: copPerUsd, alert_percent: b.alert_percent }
          : null,
        analisis: Number(tot.analisis),
        gastado_usd: usd,
        gastado_cop: gastadoCop,
        restante_cop: restanteCop,
        porcentaje: budgetCop ? Math.round((gastadoCop / budgetCop) * 1000) / 10 : null,
        promedio_dia_cop: promedioDiaCop,
        dias_restantes: promedioDiaCop && restanteCop > 0 ? Math.floor(restanteCop / promedioDiaCop) : null,
        por_flujo: porFlujo.map((f) => ({ flow: f.flow, analisis: Number(f.analisis), usd: Number(f.usd) })),
        por_dia: porDia.map((d) => ({ dia: d.dia, usd: Number(d.usd) })),
      });
    }
    return result;
  }

  async updateBudget(group, { budget_cop, start_date, cop_per_usd, alert_percent }, userId) {
    if (!['hogar', 'tyt'].includes(group)) {
      const err = new Error('Grupo inválido');
      err.statusCode = 400;
      throw err;
    }
    const row = {
      budget_cop, start_date, cop_per_usd, alert_percent,
      updated_by: userId, updated_at: db.fn.now(),
    };
    await db('gemini_budgets').insert({ billing_group: group, ...row }).onConflict('billing_group').merge();
  }
}

module.exports = new GeminiUsageService();
