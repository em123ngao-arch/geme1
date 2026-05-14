const duckdb = require('duckdb');
const path = require('path');

const dbPath = path.resolve(__dirname, 'game_duck.db');
const db = new duckdb.Database(dbPath);
const con = db.connect();

console.log('Connected to the DuckDB database.');

con.run('CREATE SEQUENCE IF NOT EXISTS id_seq;');
con.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY DEFAULT nextval('id_seq'),
        email TEXT UNIQUE,
        password TEXT,
        displayName TEXT,
        avatar TEXT,
        winsMode1 INTEGER DEFAULT 0,
        lossesMode1 INTEGER DEFAULT 0,
        winsMode2 INTEGER DEFAULT 0,
        lossesMode2 INTEGER DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) console.error('Error creating users table:', err.message);
    else {
        // Safe schema evolution for existing table
        con.run("ALTER TABLE users ADD COLUMN winsMode1 INTEGER DEFAULT 0;", () => {});
        con.run("ALTER TABLE users ADD COLUMN lossesMode1 INTEGER DEFAULT 0;", () => {});
        con.run("ALTER TABLE users ADD COLUMN winsMode2 INTEGER DEFAULT 0;", () => {});
        con.run("ALTER TABLE users ADD COLUMN lossesMode2 INTEGER DEFAULT 0;", () => {});
    }
});

con.run('CREATE SEQUENCE IF NOT EXISTS match_seq;');
con.run(`
    CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY DEFAULT nextval('match_seq'),
        mode INTEGER,
        p1Id INTEGER,
        p2Id INTEGER,
        p1Score INTEGER,
        p2Score INTEGER,
        winnerId INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) console.error('Error creating matches table:', err.message);
});

module.exports = con;
