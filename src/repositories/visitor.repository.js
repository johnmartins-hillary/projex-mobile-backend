const { query } = require("../config/database");
const BaseRepository = require("./base.repository");

class VisitorRepository extends BaseRepository {
  constructor() {
    super("visitors");
  }

  async findByProject(projectId, { date } = {}) {
    const startOfDay = date
      ? new Date(date)
      : new Date(new Date().setHours(0, 0, 0, 0));
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const { rows } = await query(
      `SELECT v.*, u.first_name AS logged_by_first, u.last_name AS logged_by_last
       FROM visitors v JOIN users u ON u.id = v.logged_by_id
       WHERE v.project_id=$1 AND v.time_in >= $2 AND v.time_in < $3 ORDER BY v.time_in DESC`,
      [projectId, startOfDay, endOfDay],
    );
    return rows;
  }

  async create(data) {
    const { rows } = await query(
      `INSERT INTO visitors (project_id,logged_by_id,full_name,company,phone,email,purpose,host_name,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        data.projectId,
        data.loggedById,
        data.fullName,
        data.company || null,
        data.phone || null,
        data.email || null,
        data.purpose,
        data.hostName || null,
        data.notes || null,
      ],
    );
    return rows[0];
  }

  async checkout(id) {
    const { rows: v } = await query("SELECT * FROM visitors WHERE id=$1", [id]);
    if (!v[0]) return null;
    const timeOut = new Date();
    const durationMins = Math.round((timeOut - v[0].time_in) / 60000);
    const { rows } = await query(
      "UPDATE visitors SET time_out=$1,duration_mins=$2,status='CHECKED_OUT' WHERE id=$3 RETURNING *",
      [timeOut, durationMins, id],
    );
    return rows[0];
  }
}

module.exports = VisitorRepository;
