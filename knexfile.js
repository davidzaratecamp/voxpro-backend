require('dotenv').config();

module.exports = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'voxpro',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'voxpro',
    charset: 'utf8mb4',
  },
  pool: { min: 2, max: 20 },
  migrations: {
    directory: './src/database/migrations',
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: './src/database/seeds',
  },
};
