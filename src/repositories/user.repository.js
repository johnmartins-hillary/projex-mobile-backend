const { query } = require("../config/database");
const BaseRepository = require("./base.repository");

class UserRepository extends BaseRepository {
  constructor() {
    super("users");
  }

  async findByEmail(email) {
    const { rows } = await query(
      "SELECT * FROM users WHERE email = $1 LIMIT 1",
      [email],
    );
    return rows[0] || null;
  }

  async findByCompanyWithCount(companyId) {
    const { rows } = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
              u.role, u.is_active, u.avatar_url, u.language,
              u.last_login_at, u.push_token, u.created_at
       FROM users u WHERE u.company_id = $1 ORDER BY u.first_name`,
      [companyId],
    );
    return rows;
  }

  async create(data) {
    const { rows } = await query(
      `INSERT INTO users (company_id, first_name, last_name, email, phone, password_hash, role)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        data.companyId || null,
        data.firstName,
        data.lastName,
        data.email,
        data.phone || null,
        data.passwordHash,
        data.role || null,
      ],
    );
    return rows[0];
  }

  async updateRefreshToken(id, token) {
    await query(
      "UPDATE users SET refresh_token = $1, last_login_at = NOW() WHERE id = $2",
      [token, id],
    );
  }

  async updateResetToken(id, token, exp) {
    await query(
      "UPDATE users SET reset_token = $1, reset_token_exp = $2 WHERE id = $3",
      [token, exp, id],
    );
  }

  async findByResetToken(token) {
    const { rows } = await query(
      "SELECT * FROM users WHERE reset_token = $1 AND reset_token_exp > NOW() LIMIT 1",
      [token],
    );
    return rows[0] || null;
  }

  async updatePassword(id, passwordHash) {
    await query(
      "UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_exp = NULL, refresh_token = NULL WHERE id = $2",
      [passwordHash, id],
    );
  }

  async updatePushToken(id, pushToken) {
    await query("UPDATE users SET push_token = $1 WHERE id = $2", [
      pushToken,
      id,
    ]);
  }

  async update(id, data) {
    const allowed = [
      "first_name",
      "last_name",
      "phone",
      "language",
      "avatar_url",
      "is_active",
      "role",
    ];
    const fields = Object.keys(data).filter((k) => allowed.includes(k));
    if (!fields.length) return null;
    const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
    const { rows } = await query(
      `UPDATE users SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...fields.map((f) => data[f])],
    );
    return rows[0];
  }
}

module.exports = UserRepository;
