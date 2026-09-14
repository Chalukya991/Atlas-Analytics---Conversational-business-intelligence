/**
 * Production hardening:
 *  - cascading deletes so removing a project/file cleans up dependants
 *  - status/error/stage columns for observable async work
 *  - indexes on the foreign keys every list query filters by
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('files', (t) => {
    t.string('status').notNullable().defaultTo('ready');
    t.text('error');
    t.dropForeign('project_id');
    t.foreign('project_id').references('id').inTable('projects').onDelete('CASCADE');
    t.index(['project_id'], 'files_project_id_idx');
  });

  await knex.schema.alterTable('datasets', (t) => {
    t.text('error');
    t.dropForeign('project_id');
    t.foreign('project_id').references('id').inTable('projects').onDelete('CASCADE');
    t.dropForeign('file_id');
    t.foreign('file_id').references('id').inTable('files').onDelete('CASCADE');
    t.index(['project_id'], 'datasets_project_id_idx');
    t.index(['file_id'], 'datasets_file_id_idx');
  });

  await knex.schema.alterTable('analyses', (t) => {
    t.string('stage').defaultTo('queued');
    t.text('error');
    t.dropForeign('project_id');
    t.foreign('project_id').references('id').inTable('projects').onDelete('CASCADE');
    t.dropForeign('dataset_id');
    t.foreign('dataset_id').references('id').inTable('datasets').onDelete('SET NULL');
    t.index(['project_id', 'created_at'], 'analyses_project_created_idx');
    t.index(['dataset_id'], 'analyses_dataset_id_idx');
  });

  await knex.schema.alterTable('reports', (t) => {
    t.string('status').notNullable().defaultTo('ready');
    t.text('error');
    t.bigInteger('size');
    t.jsonb('analysis_ids');
    t.index(['project_id'], 'reports_project_id_idx');
  });

  await knex.schema.alterTable('projects', (t) => {
    t.index(['user_id'], 'projects_user_id_idx');
    t.index(['organization_id'], 'projects_org_id_idx');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('projects', (t) => {
    t.dropIndex(['user_id'], 'projects_user_id_idx');
    t.dropIndex(['organization_id'], 'projects_org_id_idx');
  });
  await knex.schema.alterTable('reports', (t) => {
    t.dropIndex(['project_id'], 'reports_project_id_idx');
    t.dropColumns('status', 'error', 'size', 'analysis_ids');
  });
  await knex.schema.alterTable('analyses', (t) => {
    t.dropIndex(['project_id', 'created_at'], 'analyses_project_created_idx');
    t.dropIndex(['dataset_id'], 'analyses_dataset_id_idx');
    t.dropForeign('project_id');
    t.foreign('project_id').references('id').inTable('projects');
    t.dropForeign('dataset_id');
    t.foreign('dataset_id').references('id').inTable('datasets');
    t.dropColumns('stage', 'error');
  });
  await knex.schema.alterTable('datasets', (t) => {
    t.dropIndex(['project_id'], 'datasets_project_id_idx');
    t.dropIndex(['file_id'], 'datasets_file_id_idx');
    t.dropForeign('project_id');
    t.foreign('project_id').references('id').inTable('projects');
    t.dropForeign('file_id');
    t.foreign('file_id').references('id').inTable('files');
    t.dropColumn('error');
  });
  await knex.schema.alterTable('files', (t) => {
    t.dropIndex(['project_id'], 'files_project_id_idx');
    t.dropForeign('project_id');
    t.foreign('project_id').references('id').inTable('projects');
    t.dropColumns('status', 'error');
  });
};
