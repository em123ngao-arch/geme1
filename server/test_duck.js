const duckdb = require('duckdb');
const db = new duckdb.Database('test.duckdb');
const con = db.connect();

con.run('CREATE SEQUENCE IF NOT EXISTS id_seq;');
con.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY DEFAULT nextval('id_seq'),
        email TEXT UNIQUE,
        password TEXT
    )
`, (err) => {
    if (err) console.error("Table Error:", err);
    else {
        con.run('INSERT INTO users (email, password) VALUES (?, ?)', 'test@test.com', 'pass', (err) => {
            if (err) console.error("Insert Error:", err);
            else {
                con.all('SELECT * FROM users', (err, res) => {
                    console.log("Results:", res);
                });
            }
        });
    }
});
