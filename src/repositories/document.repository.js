const { query, withTransaction } = require("../config/database");

class DocumentRepository {
  async findByProject(projectId, { search, category } = {}) {
    const conditions = ["d.project_id = $1"];
    const params = [projectId];
    let i = 2;

    if (category && category !== "ALL") {
      conditions.push(`d.category = $${i++}`);
      params.push(category);
    }
    if (search) {
      conditions.push(`d.name ILIKE $${i++}`);
      params.push(`%${search}%`);
    }

    const { rows } = await query(
      `SELECT
         d.*,
         u.first_name, u.last_name,
         v.id          AS current_version_id,
         v.version_number,
         v.file_url,
         v.file_name,
         v.file_size,
         v.file_type,
         v.created_at  AS version_uploaded_at,
         (SELECT COUNT(*) FROM document_versions WHERE document_id = d.id)::int AS total_versions
       FROM project_documents d
       JOIN users u ON u.id = d.uploaded_by_id
       LEFT JOIN document_versions v ON v.document_id = d.id AND v.is_current = TRUE
       WHERE ${conditions.join(" AND ")}
       ORDER BY d.category, d.name`,
      params,
    );
    return rows;
  }

  async findById(id, projectId) {
    const { rows: docs } = await query(
      `SELECT d.*, u.first_name, u.last_name
       FROM project_documents d
       JOIN users u ON u.id = d.uploaded_by_id
       WHERE d.id = $1 AND d.project_id = $2`,
      [id, projectId],
    );
    if (!docs[0]) return null;

    const { rows: versions } = await query(
      `SELECT v.*, u.first_name, u.last_name
       FROM document_versions v
       JOIN users u ON u.id = v.uploaded_by_id
       WHERE v.document_id = $1
       ORDER BY v.version_number DESC`,
      [id],
    );

    return { ...docs[0], versions };
  }

  async create(data, versionData) {
    return withTransaction(async (client) => {
      const { rows: docs } = await client.query(
        `INSERT INTO project_documents
           (project_id, company_id, uploaded_by_id, name, description, category)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          data.projectId,
          data.companyId,
          data.uploadedById,
          data.name,
          data.description || null,
          data.category || "OTHER",
        ],
      );
      const doc = docs[0];

      const { rows: versions } = await client.query(
        `INSERT INTO document_versions
           (document_id, uploaded_by_id, version_number, file_url, file_name, file_size, file_type, public_id, notes, is_current)
         VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,TRUE) RETURNING *`,
        [
          doc.id,
          data.uploadedById,
          versionData.fileUrl,
          versionData.fileName,
          versionData.fileSize,
          versionData.fileType,
          versionData.publicId,
          versionData.notes || null,
        ],
      );

      return { ...doc, versions: [versions[0]], version_number: 1 };
    });
  }

  async addVersion(documentId, uploadedById, versionData) {
    return withTransaction(async (client) => {
      // Unset current on all existing versions
      await client.query(
        "UPDATE document_versions SET is_current = FALSE WHERE document_id = $1",
        [documentId],
      );

      // Get next version number
      const { rows: maxRows } = await client.query(
        "SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM document_versions WHERE document_id = $1",
        [documentId],
      );
      const nextVersion = maxRows[0].next;

      const { rows } = await client.query(
        `INSERT INTO document_versions
           (document_id, uploaded_by_id, version_number, file_url, file_name, file_size, file_type, public_id, notes, is_current)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE) RETURNING *`,
        [
          documentId,
          uploadedById,
          nextVersion,
          versionData.fileUrl,
          versionData.fileName,
          versionData.fileSize,
          versionData.fileType,
          versionData.publicId,
          versionData.notes || null,
        ],
      );

      // Touch parent document updated_at
      await client.query(
        "UPDATE project_documents SET updated_at = NOW() WHERE id = $1",
        [documentId],
      );

      return rows[0];
    });
  }

  async deleteVersion(versionId, documentId) {
    return withTransaction(async (client) => {
      const { rows: target } = await client.query(
        "SELECT * FROM document_versions WHERE id = $1 AND document_id = $2",
        [versionId, documentId],
      );
      if (!target[0]) return null;

      await client.query("DELETE FROM document_versions WHERE id = $1", [
        versionId,
      ]);

      // Check remaining versions
      const { rows: remaining } = await client.query(
        "SELECT * FROM document_versions WHERE document_id = $1 ORDER BY version_number DESC",
        [documentId],
      );

      if (remaining.length === 0) {
        // No versions left — delete the document itself
        await client.query("DELETE FROM project_documents WHERE id = $1", [
          documentId,
        ]);
        return { documentDeleted: true, publicId: target[0].public_id };
      }

      // If deleted version was current, promote the latest remaining
      if (target[0].is_current) {
        await client.query(
          "UPDATE document_versions SET is_current = TRUE WHERE id = $1",
          [remaining[0].id],
        );
      }

      return { documentDeleted: false, publicId: target[0].public_id };
    });
  }

  async deleteDocument(documentId) {
    // Returns all public_ids so the controller can clean up Cloudinary
    const { rows: versions } = await query(
      "SELECT public_id FROM document_versions WHERE document_id = $1",
      [documentId],
    );
    await query("DELETE FROM project_documents WHERE id = $1", [documentId]);
    return versions.map((v) => v.public_id);
  }

  async getVersion(versionId, documentId) {
    const { rows } = await query(
      "SELECT * FROM document_versions WHERE id = $1 AND document_id = $2",
      [versionId, documentId],
    );
    return rows[0] || null;
  }
}

module.exports = DocumentRepository;
