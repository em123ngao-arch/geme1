const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Sử dụng biến môi trường DATABASE_URL để kết nối
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Cần thiết khi kết nối với Supabase từ bên ngoài
  }
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

const initDb = async () => {
  const client = await pool.connect();
  try {
    console.log('Initializing Supabase tables...');
    
    // Tạo bảng users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        display_name TEXT DEFAULT '',
        avatar TEXT DEFAULT '',
        wins_mode1 INTEGER DEFAULT 0,
        losses_mode1 INTEGER DEFAULT 0,
        wins_mode2 INTEGER DEFAULT 0,
        losses_mode2 INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tạo bảng matches
    await client.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        mode INTEGER NOT NULL,
        p1_id INTEGER REFERENCES users(id),
        p2_id INTEGER REFERENCES users(id),
        p1_score INTEGER DEFAULT 0,
        p2_score INTEGER DEFAULT 0,
        winner_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tạo bảng questions
    await client.query(`
      CREATE TABLE IF NOT EXISTS questions (
        id SERIAL PRIMARY KEY,
        topic TEXT NOT NULL,
        q TEXT NOT NULL,
        options TEXT[] NOT NULL,
        a INTEGER NOT NULL,
        difficulty TEXT DEFAULT 'bình thường',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tạo các index cho bảng questions để tăng tốc độ tìm kiếm
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);
    `);

    console.log('Supabase tables ready!');
  } catch (err) {
    console.error('Error initializing Supabase database:', err);
  } finally {
    client.release();
  }
};

initDb();

module.exports = pool;
