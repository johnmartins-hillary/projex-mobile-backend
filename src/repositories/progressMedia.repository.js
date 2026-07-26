// backend/src/repositories/progressMedia.repository.js
const { query } = require("../config/database");

class ProgressMediaRepository {

  async getTimeline(companyId, projectId, dateFrom, dateTo) {
    const conds  = ["pm.company_id = $1"];
    const params = [companyId];
    if (projectId) { conds.push(`pm.project_id = $${params.length + 1}`); params.push(projectId); }
    if (dateFrom)  { conds.push(`pm.taken_at::date >= $${params.length + 1}`); params.push(dateFrom); }
    if (dateTo)    { conds.push(`pm.taken_at::date <= $${params.length + 1}`); params.push(dateTo); }

    const { rows } = await query(`
      SELECT
        TO_CHAR(pm.taken_at, 'YYYY-MM-DD')                        AS month,
        TO_CHAR(pm.taken_at, 'DD Month YYYY')                     AS month_label,
        COUNT(*)::INT                                              AS photo_count,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id',          pm.id,
            'title',       pm.title,
            'description', pm.description,
            'photoUrl',    COALESCE(pm.media_url, pm.photo_url),
            'mediaUrl',    COALESCE(pm.media_url, pm.photo_url),
            'mediaType',   pm.media_type,
            'takenAt',     pm.taken_at,
            'category',    pm.category,
            'isMilestone', pm.is_milestone,
            'location',    pm.location,
            'duration',    pm.duration
          ) ORDER BY pm.taken_at DESC
        ) AS photos
      FROM progress_photos pm
      WHERE ${conds.join(" AND ")}
      GROUP BY
        TO_CHAR(pm.taken_at, 'YYYY-MM-DD'),
        TO_CHAR(pm.taken_at, 'DD Month YYYY')
      ORDER BY month DESC
    `, params);
    return rows;
  }

  async getAll(companyId, filters = {}) {
    const { projectId, category, mediaType, limit = 50 } = filters;
    const conds  = ["pm.company_id = $1"];
    const params = [companyId];
    let i = 2;
    if (projectId) { conds.push(`pm.project_id = $${i++}`); params.push(projectId); }
    if (category)  { conds.push(`pm.category = $${i++}`);   params.push(category);  }
    if (mediaType) { conds.push(`pm.media_type = $${i++}`); params.push(mediaType); }
    params.push(Number(limit));

    const { rows } = await query(`
      SELECT pm.*,
        COALESCE(pm.media_url, pm.photo_url) AS media_url,
        u.first_name, u.last_name,
        p.name AS project_name
      FROM progress_photos pm
      LEFT JOIN users u    ON u.id  = pm.taken_by_id
      LEFT JOIN projects p ON p.id  = pm.project_id
      WHERE ${conds.join(" AND ")}
      ORDER BY pm.taken_at DESC
      LIMIT $${i}
    `, params);
    return rows;
  }

  async create(data) {
    const {
      projectId, companyId, userId,
      title, description, location,
      takenAt, category, isMilestone,
      mediaUrl, mediaType, publicId, duration, photoUrl,
    } = data;

    const { rows: [record] } = await query(`
      INSERT INTO progress_photos
        (project_id, company_id, title, description,
         photo_url, media_url, media_type, public_id, duration,
         location, taken_at, taken_by_id, category, is_milestone)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [
      projectId, companyId,
      title, description || null,
      mediaUrl || photoUrl || null,   // photo_url kept for backward compat
      mediaUrl || photoUrl || null,   // media_url
      mediaType || "photo",
      publicId  || null,
      duration  || null,
      location  || null,
      takenAt   || new Date(),
      userId,
      category  || "GENERAL",
      isMilestone || false,
    ]);
    return record;
  }

  async bulkCreate(records) {
    // Build a multi-row INSERT
    const cols = [
      "company_id","project_id","title","description","location",
      "category","is_milestone","taken_at","taken_by_id",
      "photo_url","media_url","media_type","public_id","duration",
    ];
    const values = [];
    const params = [];
    let   pi     = 1;

    for (const r of records) {
      const row = [
        r.companyId, r.projectId, r.title, r.description || null,
        r.location || null, r.category, r.isMilestone, r.takenAt,
        r.takenById, r.mediaUrl, r.mediaUrl, r.mediaType,
        r.publicId || null, r.duration || null,
      ];
      values.push(`(${row.map(() => `$${pi++}`).join(",")})`);
      params.push(...row);
    }

    const { rows } = await query(
      `INSERT INTO progress_photos (${cols.join(",")})
       VALUES ${values.join(",")}
       RETURNING *`,
      params,
    );
    return rows;
  }

  async delete(id, companyId) {
    const { rows: [record] } = await query(
      `DELETE FROM progress_photos WHERE id=$1 AND company_id=$2 RETURNING public_id, media_type`,
      [id, companyId],
    );
    return record; // returns public_id so controller can delete from Cloudinary
  }
}

module.exports = ProgressMediaRepository;