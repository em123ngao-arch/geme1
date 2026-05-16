const pool = require('./db');

async function checkUser() {
    try {
        const result = await pool.query('SELECT id, email FROM users WHERE email ILIKE $1', ['%nguoichoi2@gmail.com%']);
        console.log('Users matching "nguoichoi2@gmail.com":');
        console.table(result.rows);
        
        const allUsers = await pool.query('SELECT id, email FROM users ORDER BY created_at DESC LIMIT 5');
        console.log('Latest 5 users:');
        console.table(allUsers.rows);
    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

checkUser();
