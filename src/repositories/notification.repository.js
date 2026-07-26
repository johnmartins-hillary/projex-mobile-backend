const { query } = require("../config/database");
const BaseRepository = require("./base.repository");

class NotificationRepository extends BaseRepository {
  constructor() {
    super("notifications");
  }

  async findByUser(userId, limit = 50) {
    const { rows } = await query(
      "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
      [userId, limit],
    );
    return rows;
  }

  async create(data) {
    const { rows } = await query(
      "INSERT INTO notifications (user_id,title,body,type,data) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [
        data.userId,
        data.title,
        data.body,
        data.type || "GENERAL",
        data.data ? JSON.stringify(data.data) : null,
      ],
    );
    return rows[0];
  }

  async markAllRead(userId) {
    await query(
      "UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE",
      [userId],
    );
  }

  async markRead(id, userId) {
    await query(
      "UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2",
      [id, userId],
    );
  }

  async createBulk(userIds, data) {
    for (const userId of userIds) {
      await this.create({ ...data, userId });
    }
  }
}

module.exports = NotificationRepository;
