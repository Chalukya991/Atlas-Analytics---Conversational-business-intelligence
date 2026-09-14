const db = require('../database');
const { v4: uuidv4 } = require('uuid');

const j = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

const User = {
  create: async ({ email, passwordHash, name, organizationId }) => {
    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO users (id, email, password_hash, name, organization_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name, organization_id`,
      [id, email, passwordHash, name, organizationId],
    );
    return result.rows[0];
  },
  findByEmail: async (email) => {
    const result = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    return result.rows[0];
  },
  findById: async (id) => {
    const result = await db.query('SELECT id, email, name, organization_id FROM users WHERE id = $1', [id]);
    return result.rows[0];
  },
  findByIdWithHash: async (id) => {
    const result = await db.query('SELECT id, email, name, organization_id, password_hash FROM users WHERE id = $1', [id]);
    return result.rows[0];
  },
  updatePassword: async (id, passwordHash) => {
    await db.query('UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1', [id, passwordHash]);
  },
};

const Organization = {
  create: async (name) => {
    const id = uuidv4();
    const result = await db.query('INSERT INTO organizations (id, name) VALUES ($1, $2) RETURNING id, name', [id, name]);
    return result.rows[0];
  },
};

const OWNED = '(p.user_id = $2 OR (p.organization_id IS NOT NULL AND p.organization_id = $3))';

const Project = {
  create: async ({ name, description, userId, organizationId }) => {
    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO projects (id, name, description, user_id, organization_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, description, created_at, updated_at`,
      [id, name, description || null, userId, organizationId],
    );
    return result.rows[0];
  },
  findOwned: async ({ userId, organizationId, limit = 100, offset = 0 }) => {
    const result = await db.query(
      `SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
              (SELECT COUNT(*) FROM datasets d WHERE d.project_id = p.id AND d.status = 'ready')::int AS dataset_count,
              (SELECT COUNT(*) FROM analyses a WHERE a.project_id = p.id AND a.status = 'completed')::int AS analysis_count,
              (SELECT COUNT(*) FROM reports r WHERE r.project_id = p.id AND r.storage_path IS NOT NULL)::int AS report_count,
              (SELECT MAX(a.created_at) FROM analyses a WHERE a.project_id = p.id) AS last_activity_at
       FROM projects p
       WHERE (p.user_id = $1 OR (p.organization_id IS NOT NULL AND p.organization_id = $2))
       ORDER BY p.updated_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, organizationId, limit, offset],
    );
    return result.rows;
  },
  findOwnedById: async ({ userId, organizationId, projectId }) => {
    const result = await db.query(
      `SELECT p.id, p.name, p.description, p.created_at, p.updated_at
       FROM projects p
       WHERE p.id = $1 AND ${OWNED}`,
      [projectId, userId, organizationId],
    );
    return result.rows[0] || null;
  },
  update: async ({ projectId, name, description }) => {
    const result = await db.query(
      `UPDATE projects SET name = COALESCE($2, name), description = COALESCE($3, description), updated_at = NOW()
       WHERE id = $1 RETURNING id, name, description, created_at, updated_at`,
      [projectId, name ?? null, description ?? null],
    );
    return result.rows[0] || null;
  },
  touch: async (projectId) => {
    await db.query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [projectId]);
  },
  delete: async (projectId) => {
    // Return file paths so the caller can clean the storage.
    const files = await db.query('SELECT storage_path FROM files WHERE project_id = $1', [projectId]);
    const reports = await db.query('SELECT storage_path FROM reports WHERE project_id = $1', [projectId]);
    await db.query('DELETE FROM projects WHERE id = $1', [projectId]);
    return [...files.rows, ...reports.rows].map((r) => r.storage_path).filter(Boolean);
  },
};

const File = {
  create: async ({ originalName, storagePath, size, mimeType, projectId }) => {
    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO files (id, original_name, storage_path, size, mime_type, project_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'processing') RETURNING id, original_name, size, status, created_at`,
      [id, originalName, storagePath, size, mimeType, projectId],
    );
    return result.rows[0];
  },
  setStatus: async ({ id, status, error }) => {
    await db.query('UPDATE files SET status = $2, error = $3, updated_at = NOW() WHERE id = $1', [id, status, error || null]);
  },
  findOwnedByProject: async ({ userId, organizationId, projectId, fileId }) => {
    const result = await db.query(
      `SELECT f.*
       FROM files f JOIN projects p ON f.project_id = p.id
       WHERE f.id = $1 AND p.id = $4 AND ${OWNED}`,
      [fileId, userId, organizationId, projectId],
    );
    return result.rows[0] || null;
  },
  listByProject: async ({ userId, organizationId, projectId }) => {
    const result = await db.query(
      `SELECT f.id, f.original_name, f.size, f.mime_type, f.status, f.error, f.created_at,
              (SELECT COUNT(*) FROM datasets d WHERE d.file_id = f.id)::int AS dataset_count
       FROM files f JOIN projects p ON f.project_id = p.id
       WHERE p.id = $1 AND (p.user_id = $2 OR (p.organization_id IS NOT NULL AND p.organization_id = $3))
       ORDER BY f.created_at DESC`,
      [projectId, userId, organizationId],
    );
    return result.rows;
  },
  delete: async (fileId) => {
    const result = await db.query('DELETE FROM files WHERE id = $1 RETURNING storage_path', [fileId]);
    return result.rows[0] ? result.rows[0].storage_path : null;
  },
};

const Dataset = {
  findById: async (id) => {
    const result = await db.query(
      `SELECT ds.*, f.storage_path, f.original_name
       FROM datasets ds LEFT JOIN files f ON ds.file_id = f.id
       WHERE ds.id = $1`,
      [id],
    );
    return result.rows[0] || null;
  },
  findOwnedById: async ({ userId, organizationId, projectId, datasetId }) => {
    const result = await db.query(
      `SELECT ds.*, f.storage_path, f.original_name
       FROM datasets ds
       JOIN projects p ON ds.project_id = p.id
       LEFT JOIN files f ON ds.file_id = f.id
       WHERE ds.id = $1 AND p.id = $4 AND ${OWNED}`,
      [datasetId, userId, organizationId, projectId],
    );
    return result.rows[0] || null;
  },
  create: async ({ fileId, projectId, name, metadata, columns, statistics, status, error }) => {
    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO datasets (id, file_id, project_id, name, metadata, columns, statistics, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [id, fileId, projectId, name, j(metadata || {}), j(columns || []), j(statistics || {}), status || 'pending', error || null],
    );
    return result.rows[0];
  },
  updateStatus: async ({ id, status, columns, statistics, error }) => {
    const result = await db.query(
      `UPDATE datasets
       SET status = $2, columns = COALESCE($3, columns), statistics = COALESCE($4, statistics), error = $5, updated_at = NOW()
       WHERE id = $1 RETURNING id`,
      [id, status, j(columns), j(statistics), error || null],
    );
    return result.rows[0] || null;
  },
  listByProject: async ({ userId, organizationId, projectId }) => {
    const result = await db.query(
      `SELECT ds.id, ds.name, ds.status, ds.error, ds.metadata, ds.columns, ds.statistics, ds.file_id, ds.created_at,
              f.original_name, f.size,
              (SELECT COUNT(*) FROM analyses a WHERE a.dataset_id = ds.id AND a.status = 'completed')::int AS analysis_count
       FROM datasets ds
       JOIN projects p ON ds.project_id = p.id
       LEFT JOIN files f ON ds.file_id = f.id
       WHERE ds.project_id = $1 AND (p.user_id = $2 OR (p.organization_id IS NOT NULL AND p.organization_id = $3))
       ORDER BY ds.created_at DESC`,
      [projectId, userId, organizationId],
    );
    return result.rows;
  },
};

const ANALYSIS_LIST_COLUMNS = `a.id, a.question, a.status, a.stage, a.error, a.dataset_id, a.plan, a.results, a.explanation, a.created_at, a.updated_at,
  ds.name AS dataset_name`;

const Analysis = {
  create: async ({ projectId, datasetId, question, status }) => {
    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO analyses (id, project_id, dataset_id, question, status, stage)
       VALUES ($1, $2, $3, $4, $5, 'queued') RETURNING id, created_at`,
      [id, projectId, datasetId, question, status || 'queued'],
    );
    return result.rows[0];
  },
  updateResult: async ({ id, plan, results, explanation, status, stage, error }) => {
    const result = await db.query(
      `UPDATE analyses
       SET plan = COALESCE($2, plan),
           results = COALESCE($3, results),
           explanation = COALESCE($4, explanation),
           status = COALESCE($5, status),
           stage = COALESCE($6, stage),
           error = $7,
           updated_at = NOW()
       WHERE id = $1 RETURNING id`,
      [id, j(plan), j(results), j(explanation), status || null, stage || null, error || null],
    );
    return result.rows[0] || null;
  },
  setStage: async (id, stage) => {
    await db.query('UPDATE analyses SET stage = $2, status = $3, updated_at = NOW() WHERE id = $1', [id, stage, 'running']);
  },
  findOwnedById: async ({ userId, organizationId, projectId, analysisId }) => {
    const result = await db.query(
      `SELECT ${ANALYSIS_LIST_COLUMNS}
       FROM analyses a
       JOIN projects p ON a.project_id = p.id
       LEFT JOIN datasets ds ON ds.id = a.dataset_id
       WHERE a.id = $1 AND p.id = $4 AND ${OWNED}`,
      [analysisId, userId, organizationId, projectId],
    );
    return result.rows[0] || null;
  },
  listByProject: async ({ userId, organizationId, projectId, limit = 100, includeResults = true }) => {
    const cols = includeResults
      ? ANALYSIS_LIST_COLUMNS
      : 'a.id, a.question, a.status, a.stage, a.error, a.dataset_id, a.created_at, a.updated_at, ds.name AS dataset_name';
    const result = await db.query(
      `SELECT ${cols}
       FROM analyses a
       JOIN projects p ON a.project_id = p.id
       LEFT JOIN datasets ds ON ds.id = a.dataset_id
       WHERE a.project_id = $1 AND (p.user_id = $2 OR (p.organization_id IS NOT NULL AND p.organization_id = $3))
       ORDER BY a.created_at ASC
       LIMIT $4`,
      [projectId, userId, organizationId, limit],
    );
    return result.rows;
  },
  listCompletedByIds: async ({ projectId, analysisIds }) => {
    const result = await db.query(
      `SELECT a.id, a.question, a.plan, a.results, a.explanation, a.created_at, ds.name AS dataset_name
       FROM analyses a LEFT JOIN datasets ds ON ds.id = a.dataset_id
       WHERE a.project_id = $1 AND a.status = 'completed' AND ($2::uuid[] IS NULL OR a.id = ANY($2::uuid[]))
       ORDER BY a.created_at ASC`,
      [projectId, analysisIds && analysisIds.length ? analysisIds : null],
    );
    return result.rows;
  },
  recentCompleted: async ({ projectId, datasetId, limit = 5 }) => {
    const result = await db.query(
      `SELECT a.question, a.plan, a.explanation, a.created_at
       FROM analyses a
       WHERE a.project_id = $1 AND a.status = 'completed' AND ($2::uuid IS NULL OR a.dataset_id = $2)
       ORDER BY a.created_at DESC LIMIT $3`,
      [projectId, datasetId || null, limit],
    );
    return result.rows.reverse();
  },
  delete: async (analysisId) => {
    await db.query('DELETE FROM analyses WHERE id = $1', [analysisId]);
  },
};

const Report = {
  create: async ({ projectId, name, format, version, createdBy, analysisIds }) => {
    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO reports (id, project_id, name, format, storage_path, version, created_by, status, analysis_ids)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, 'queued', $7) RETURNING id, name, format, version, status, created_at`,
      [id, projectId, name, format, version || 1, createdBy, j(analysisIds || null)],
    );
    return result.rows[0];
  },
  nextVersion: async (projectId) => {
    const result = await db.query('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM reports WHERE project_id = $1', [projectId]);
    return result.rows[0].next;
  },
  markReady: async ({ id, storagePath, size }) => {
    const result = await db.query(
      `UPDATE reports SET storage_path = $2, status = 'ready', size = $3, error = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING id, storage_path, version, format, name, status`,
      [id, storagePath, size || null],
    );
    return result.rows[0] || null;
  },
  markFailed: async ({ id, error }) => {
    await db.query(`UPDATE reports SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`, [id, error]);
  },
  listByProject: async ({ projectId, userId, organizationId }) => {
    const result = await db.query(
      `SELECT r.id, r.name, r.format, r.version, r.status, r.error, r.size, r.analysis_ids, r.created_at,
              (r.storage_path IS NOT NULL) AS downloadable
       FROM reports r JOIN projects p ON r.project_id = p.id
       WHERE r.project_id = $1 AND (p.user_id = $2 OR (p.organization_id IS NOT NULL AND p.organization_id = $3))
       ORDER BY r.created_at DESC`,
      [projectId, userId, organizationId],
    );
    return result.rows;
  },
  findOwnedById: async ({ projectId, reportId, userId, organizationId }) => {
    const result = await db.query(
      `SELECT r.*
       FROM reports r JOIN projects p ON r.project_id = p.id
       WHERE r.id = $1 AND p.id = $4 AND ${OWNED}`,
      [reportId, userId, organizationId, projectId],
    );
    return result.rows[0] || null;
  },
  delete: async (reportId) => {
    const result = await db.query('DELETE FROM reports WHERE id = $1 RETURNING storage_path', [reportId]);
    return result.rows[0] ? result.rows[0].storage_path : null;
  },
};

module.exports = { User, Organization, Project, File, Dataset, Analysis, Report };
