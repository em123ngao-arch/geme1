const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkDb() {
  try {
    const users = await pool.query('SELECT id, email, display_name, wins_mode1, wins_mode2 FROM users');
    console.log('--- Users ---');
    console.table(users.rows);

    const matches = await pool.query('SELECT * FROM matches ORDER BY created_at DESC LIMIT 5');
    console.log('--- Recent Matches ---');
    console.table(matches.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

checkDb();
