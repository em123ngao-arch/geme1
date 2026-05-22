const db = require('./db');

async function run() {
    try {
        const res = await db.query('SELECT topic, COUNT(*) as count FROM questions GROUP BY topic ORDER BY count DESC');
        console.log("Current questions in database:");
        console.table(res.rows);
        const totalRes = await db.query('SELECT COUNT(*) as count FROM questions');
        console.log(`Total questions: ${totalRes.rows[0].count}`);
    } catch (e) {
        console.error(e);
    } finally {
        db.end();
    }
}

run();
