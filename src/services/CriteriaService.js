const db = require('../database/connection');

class CriteriaService {
  constructor() {
    this._cache = new Map();
  }

  /**
   * Returns all campaigns (no cache — admin always sees fresh data).
   */
  async getAll() {
    const rows = await db('criteria_configs').select('*').orderBy('client_group').orderBy('campaign_key');
    return rows.map((r) => this._rowToShape(r));
  }

  /**
   * Returns a single campaign by key (cache-first).
   * Parses JSON columns if they come back as strings (MySQL returns strings).
   */
  async getByKey(key) {
    if (this._cache.has(key)) return this._cache.get(key);

    const row = await db('criteria_configs').where('campaign_key', key).first();
    if (!row) throw new Error(`No criteria config found for campaign: ${key}`);

    const shaped = this._rowToShape(row);
    this._cache.set(key, shaped);
    return shaped;
  }

  /**
   * Updates a campaign config and invalidates its cache entry.
   */
  async update(key, { generalCriteria, highImpactCriteria, naRules, specialInstructions, updatedBy }) {
    await db('criteria_configs').where('campaign_key', key).update({
      general_criteria:     JSON.stringify(generalCriteria),
      high_impact_criteria: JSON.stringify(highImpactCriteria),
      na_rules:             JSON.stringify(naRules),
      special_instructions: specialInstructions || null,
      updated_by:           updatedBy || null,
      updated_at:           db.fn.now(),
    });
    this._cache.delete(key);
    return this.getByKey(key);
  }

  _rowToShape(row) {
    const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
    return {
      key:                 row.campaign_key,
      clientGroup:         row.client_group,
      label:               row.campaign_label,
      general:             parse(row.general_criteria),
      highImpact:          parse(row.high_impact_criteria),
      naRules:             parse(row.na_rules),
      specialInstructions: row.special_instructions || null,
      updatedBy:           row.updated_by,
      updatedAt:           row.updated_at,
    };
  }
}

module.exports = new CriteriaService();
