exports.up = function (knex) {
  return knex.schema.createTable('reports', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('project_id')
      .references('id')
      .inTable('projects')
      .onDelete('CASCADE');
    table.string('name').notNullable();
    table.string('format').notNullable().defaultTo('pdf');
    table.string('storage_path');
    table.integer('version').notNullable().defaultTo(1);
    table.uuid('created_by').references('id').inTable('users');
    table.jsonb('content');
    table.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('reports');
};