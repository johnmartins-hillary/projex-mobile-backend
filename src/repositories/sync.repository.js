const { query } = require("../config/database");

class SyncRepository {
  async getChangesSince(companyId, since) {
    const tables = [
      { name: "materials", fields: "m.*", join: "", where: "m.company_id=$1" },
      { name: "equipment", fields: "e.*", join: "", where: "e.company_id=$1" },
      { name: "projects", fields: "p.*", join: "", where: "p.company_id=$1" },
      {
        name: "budgets",
        fields: "b.*",
        join: "JOIN projects p ON p.id=b.project_id",
        where: "p.company_id=$1",
      },
      {
        name: "expenses",
        fields: "ex.*",
        join: "JOIN projects p ON p.id=ex.project_id",
        where: "p.company_id=$1",
      },
      {
        name: "visitors",
        fields: "v.*",
        join: "JOIN projects p ON p.id=v.project_id",
        where: "p.company_id=$1",
      },
      {
        name: "stock_transactions",
        fields: "st.*",
        join: "JOIN materials m ON m.id=st.material_id",
        where: "m.company_id=$1",
      },
      { name: "suppliers", fields: "s.*", join: "", where: "s.company_id=$1" },
    ];

    const changes = {};
    for (const t of tables) {
      const alias = t.name.split("_")[0][0];
      const { rows } = await query(
        `SELECT ${t.fields} FROM ${t.name} ${alias.includes(" ") ? "" : alias}
         ${t.join} WHERE ${t.where} AND ${alias}.${t.name === "stock_transactions" ? "st." : alias.charAt(0) + "."}created_at > $2
         ORDER BY created_at DESC LIMIT 500`.replace(/\bst\.\b/g, "st."),
        [companyId, since],
      );
      changes[t.name] = rows;
    }
    return changes;
  }

  async updateCursor(userId, deviceId) {
    await query(
      `INSERT INTO sync_cursors (user_id, device_id, last_pulled_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (user_id, device_id) DO UPDATE SET last_pulled_at=NOW()`,
      [userId, deviceId],
    );
  }

  async getCursor(userId, deviceId) {
    const { rows } = await query(
      "SELECT last_pulled_at FROM sync_cursors WHERE user_id=$1 AND device_id=$2",
      [userId, deviceId],
    );
    return rows[0]?.last_pulled_at || new Date(0);
  }
}

module.exports = SyncRepository;
