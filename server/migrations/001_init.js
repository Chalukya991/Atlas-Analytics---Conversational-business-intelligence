exports.up = function(knex) {
  return knex.schema
    .createTable('organizations', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('name').notNullable();
      table.timestamps(true, true);
    })
    .createTable('users', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('email').unique().notNullable();
      table.string('password_hash').notNullable();
      table.string('name');
      table.uuid('organization_id').references('id').inTable('organizations');
      table.timestamps(true, true);
    })
    .createTable('projects', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('name').notNullable();
      table.text('description');
      table.uuid('user_id').references('id').inTable('users');
      table.uuid('organization_id').references('id').inTable('organizations');
      table.timestamps(true, true);
    })
    .createTable('files', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('original_name').notNullable();
      table.string('storage_path').notNullable();
      table.bigInteger('size');
      table.string('mime_type');
      table.uuid('project_id').references('id').inTable('projects');
      table.timestamps(true, true);
    })
    .createTable('datasets', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('name').notNullable();
      table.jsonb('metadata');
      table.jsonb('columns');
      table.jsonb('statistics');
      table.string('status').defaultTo('pending');
      table.uuid('file_id').references('id').inTable('files');
      table.uuid('project_id').references('id').inTable('projects');
      table.timestamps(true, true);
    })
    .createTable('analyses', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('question');
      table.jsonb('plan');
      table.jsonb('results');
      table.jsonb('explanation');
      table.string('status').defaultTo('pending');
      table.uuid('dataset_id').references('id').inTable('datasets');
      table.uuid('project_id').references('id').inTable('projects');
      table.timestamps(true, true);
    })
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('analyses')
    .dropTableIfExists('datasets')
    .dropTableIfExists('files')
    .dropTableIfExists('projects')
    .dropTableIfExists('users')
    .dropTableIfExists('organizations');
};
