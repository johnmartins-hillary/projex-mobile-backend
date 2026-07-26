const { query, withTransaction } = require("../config/database");

class ChatRepository {
  // ── Room ───────────────────────────────────────────────────

  async getOrCreateRoom(projectId, companyId) {
    const {
      rows: [existing],
    } = await query(`SELECT * FROM chat_rooms WHERE project_id = $1`, [
      projectId,
    ]);
    if (existing) return existing;
    const {
      rows: [room],
    } = await query(
      `INSERT INTO chat_rooms (project_id, company_id) VALUES ($1,$2) RETURNING *`,
      [projectId, companyId],
    );
    return room;
  }

  // ── Message select fragment ────────────────────────────────

  _msgSelect() {
    return `
      SELECT
        m.id, m.room_id, m.sender_id, m.type, m.content,
        m.file_url, m.file_name, m.file_size, m.duration,
        m.reply_to_id, m.is_deleted, m.is_edited, m.edited_at,
        m.group_id, m.mentions, m.thumb_url,
        m.media_width, m.media_height, m.created_at, m.updated_at,
        u.first_name, u.last_name, u.avatar_url,
        -- Reply snapshot
        rm.content      AS reply_content,
        rm.type         AS reply_type,
        rm.file_url     AS reply_file_url,
        rm.thumb_url    AS reply_thumb_url,
        ru.first_name   AS reply_first_name,
        ru.last_name    AS reply_last_name,
        ru.avatar_url   AS reply_avatar_url,
        -- Reactions
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'emoji',      r.emoji,
              'user_id',    r.user_id,
              'first_name', rru.first_name
            )
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'
        ) AS reactions
      FROM chat_messages m
      JOIN users u ON u.id = m.sender_id
      LEFT JOIN chat_messages rm ON rm.id = m.reply_to_id
      LEFT JOIN users ru ON ru.id = rm.sender_id
      LEFT JOIN chat_reactions r ON r.message_id = m.id
      LEFT JOIN users rru ON rru.id = r.user_id
    `;
  }

  // ── Get messages (paginated, newest-first internally then reversed) ─

  async getMessages(roomId, { limit = 50, before = null } = {}) {
    const params = [roomId, limit];
    const beforeClause = before ? `AND m.created_at < $3` : "";
    if (before) params.push(before);

    const { rows } = await query(
      `
      ${this._msgSelect()}
      WHERE m.room_id = $1 ${beforeClause}
      GROUP BY m.id, u.first_name, u.last_name, u.avatar_url,
               rm.content, rm.type, rm.file_url, rm.thumb_url,
               ru.first_name, ru.last_name, ru.avatar_url
      ORDER BY m.created_at DESC
      LIMIT $2
    `,
      params,
    );

    return rows.reverse(); // chronological for display
  }

  async getMessageById(messageId) {
    const {
      rows: [msg],
    } = await query(
      `
      ${this._msgSelect()}
      WHERE m.id = $1
      GROUP BY m.id, u.first_name, u.last_name, u.avatar_url,
               rm.content, rm.type, rm.file_url, rm.thumb_url,
               ru.first_name, ru.last_name, ru.avatar_url
    `,
      [messageId],
    );
    return msg || null;
  }

  // ── Create message ─────────────────────────────────────────

  async createMessage(roomId, senderId, data) {
    const {
      rows: [msg],
    } = await query(
      `
      INSERT INTO chat_messages
        (room_id, sender_id, type, content, file_url, file_name,
         file_size, duration, reply_to_id, group_id, mentions,
         thumb_url, media_width, media_height)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id
    `,
      [
        roomId,
        senderId,
        data.type || "TEXT",
        data.content || null,
        data.fileUrl || null,
        data.fileName || null,
        data.fileSize || null,
        data.duration || null,
        data.replyToId || null,
        data.groupId || null,
        JSON.stringify(data.mentions || []),
        data.thumbUrl || null,
        data.mediaWidth || null,
        data.mediaHeight || null,
      ],
    );
    return this.getMessageById(msg.id);
  }

  // ── Create bulk media messages (images/videos sent together) ──

  async createBulkMessages(roomId, senderId, files, replyToId, mentions) {
    const groupId = require("crypto").randomUUID();
    const messages = [];

    await withTransaction(async (client) => {
      for (const file of files) {
        const {
          rows: [msg],
        } = await client.query(
          `
          INSERT INTO chat_messages
            (room_id, sender_id, type, file_url, file_name, file_size,
             group_id, reply_to_id, mentions, thumb_url, media_width, media_height)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          RETURNING id
        `,
          [
            roomId,
            senderId,
            file.type, // IMAGE or VIDEO
            file.fileUrl,
            file.fileName || null,
            file.fileSize || null,
            groupId,
            replyToId || null,
            JSON.stringify(mentions || []),
            file.thumbUrl || null,
            file.mediaWidth || null,
            file.mediaHeight || null,
          ],
        );
        messages.push(msg.id);
      }
    });

    // Fetch all with full joins
    const full = await Promise.all(
      messages.map((id) => this.getMessageById(id)),
    );
    return full.filter(Boolean);
  }

  // ── Edit message ───────────────────────────────────────────

  async editMessage(messageId, senderId, content) {
    const {
      rows: [existing],
    } = await query(
      `SELECT sender_id, is_deleted FROM chat_messages WHERE id = $1`,
      [messageId],
    );
    if (!existing) return null;
    if (existing.sender_id !== senderId)
      throw new Error("Cannot edit another user's message");
    if (existing.is_deleted) throw new Error("Cannot edit a deleted message");

    await query(
      `
      UPDATE chat_messages
      SET content = $1, is_edited = TRUE, edited_at = NOW()
      WHERE id = $2
    `,
      [content, messageId],
    );

    return this.getMessageById(messageId);
  }

  // ── Delete message ─────────────────────────────────────────

  async deleteMessage(messageId, senderId) {
    const {
      rows: [msg],
    } = await query(`SELECT sender_id FROM chat_messages WHERE id = $1`, [
      messageId,
    ]);
    if (!msg) return null;
    if (msg.sender_id !== senderId)
      throw new Error("Cannot delete another user's message");

    await query(`UPDATE chat_messages SET is_deleted = TRUE WHERE id = $1`, [
      messageId,
    ]);
    return { id: messageId };
  }

  // ── Reactions ──────────────────────────────────────────────

  async toggleReaction(messageId, userId, emoji) {
    const {
      rows: [existing],
    } = await query(
      `SELECT id FROM chat_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`,
      [messageId, userId, emoji],
    );
    if (existing) {
      await query(`DELETE FROM chat_reactions WHERE id=$1`, [existing.id]);
    } else {
      await query(
        `INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)`,
        [messageId, userId, emoji],
      );
    }
    const { rows } = await query(
      `
      SELECT r.emoji, r.user_id, u.first_name
      FROM chat_reactions r JOIN users u ON u.id = r.user_id
      WHERE r.message_id = $1
    `,
      [messageId],
    );
    return rows;
  }

  // ── Read receipts ──────────────────────────────────────────

  async markRead(roomId, userId) {
    await query(
      `
      INSERT INTO chat_read_receipts (user_id, room_id, last_read_at)
      VALUES ($1,$2,NOW())
      ON CONFLICT (user_id, room_id) DO UPDATE SET last_read_at = NOW()
    `,
      [userId, roomId],
    );
  }

  async getUnreadCount(roomId, userId) {
    const {
      rows: [receipt],
    } = await query(
      `SELECT last_read_at FROM chat_read_receipts WHERE user_id=$1 AND room_id=$2`,
      [userId, roomId],
    );
    const since = receipt?.last_read_at;
    const {
      rows: [{ count }],
    } = await query(
      `
      SELECT COUNT(*)::int AS count FROM chat_messages
      WHERE room_id=$1 AND is_deleted=FALSE AND sender_id!=$2
      ${since ? "AND created_at > $3" : ""}
    `,
      since ? [roomId, userId, since] : [roomId, userId],
    );
    return count;
  }

  // ── Room info ──────────────────────────────────────────────

  async getSchedule(projectId, userId) {
    const {
      rows: [room],
    } = await query(
      `
      SELECT r.*, p.name AS project_name,
        lm.type AS last_message_type, lm.content AS last_message_content,
        lm.created_at AS last_message_at,
        lu.first_name AS last_sender_first_name
      FROM chat_rooms r
      JOIN projects p ON p.id = r.project_id
      LEFT JOIN LATERAL (
        SELECT * FROM chat_messages WHERE room_id=r.id AND is_deleted=FALSE
        ORDER BY created_at DESC LIMIT 1
      ) lm ON TRUE
      LEFT JOIN users lu ON lu.id = lm.sender_id
      WHERE r.project_id = $1
    `,
      [projectId],
    );
    if (!room) return null;
    const unread = await this.getUnreadCount(room.id, userId);
    return { ...room, unread_count: unread };
  }

  // ── Get room + initial messages ────────────────────────────

  async getRoom(projectId, companyId, userId) {
    const room = await this.getOrCreateRoom(projectId, companyId);
    const messages = await this.getMessages(room.id, { limit: 50 });
    await this.markRead(room.id, userId);
    return { room, messages };
  }

  // ── Get project members (for @mention picker) ─────────────

  async getProjectMembers(projectId, companyId) {
    const { rows } = await query(
      `
      SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.role
      FROM users u
      WHERE u.company_id = $1
      ORDER BY u.first_name ASC
    `,
      [companyId],
    );
    return rows;
  }
}

module.exports = ChatRepository;
