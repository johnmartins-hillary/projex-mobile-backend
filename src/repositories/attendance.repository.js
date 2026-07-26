const { query } = require("../config/database");
const BaseRepository = require("./base.repository");

class AttendanceRepository extends BaseRepository {
  constructor() {
    super("attendances");
  }

  async findTodayByUser(userId, projectId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { rows } = await query(
      "SELECT * FROM attendances WHERE user_id=$1 AND project_id=$2 AND check_in >= $3 AND check_out IS NULL LIMIT 1",
      [userId, projectId, today],
    );
    return rows[0] || null;
  }

  async checkIn(data) {
    const { rows } = await query(
      "INSERT INTO attendances (project_id,user_id,latitude,longitude,daily_rate) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [
        data.projectId,
        data.userId,
        data.latitude || null,
        data.longitude || null,
        data.dailyRate || null,
      ],
    );
    return rows[0];
  }

  async checkOut(id) {
    const { rows: rec } = await query("SELECT * FROM attendances WHERE id=$1", [
      id,
    ]);
    if (!rec[0]) return null;
    const checkOut = new Date();
    const hoursWorked = (checkOut - rec[0].check_in) / 3600000;
    const totalPay = rec[0].daily_rate
      ? (hoursWorked / 8) * parseFloat(rec[0].daily_rate)
      : null;
    const { rows } = await query(
      "UPDATE attendances SET check_out=$1,hours_worked=$2,total_pay=$3 WHERE id=$4 RETURNING *",
      [
        checkOut,
        Math.round(hoursWorked * 100) / 100,
        totalPay ? Math.round(totalPay) : null,
        id,
      ],
    );
    return rows[0];
  }

  async findByProject(projectId, date) {
    const startOfDay = date
      ? new Date(date)
      : new Date(new Date().setHours(0, 0, 0, 0));
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const { rows } = await query(
      `SELECT a.*, u.first_name, u.last_name, u.role, p.name AS project_name
       FROM attendances a JOIN users u ON u.id=a.user_id JOIN projects p ON p.id=a.project_id
       WHERE a.project_id=$1 AND a.check_in >= $2 AND a.check_in < $3 ORDER BY a.check_in DESC`,
      [projectId, startOfDay, endOfDay],
    );
    return rows;
  }
}

module.exports = AttendanceRepository;
