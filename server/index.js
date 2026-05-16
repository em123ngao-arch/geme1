const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');
const GameManager = require('./socket/gameManager');

const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const io = new Server(server, {
    cors: {
        origin: FRONTEND_URL, 
        methods: ['GET', 'POST']
    }
});

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-dev';

// --- Auth Routes ---
app.post('/register', async (req, res) => {
    let { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    email = email.toLowerCase().trim();

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO users (email, password) VALUES ($1, $2)', [email, hashedPassword]);
        res.json({ success: true, message: 'Registration successful' });
    } catch (err) {
        if (err.code === '23505') { // PostgreSQL unique violation
            return res.status(400).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/login', async (req, res) => {
    let { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    email = email.trim();

    try {
        // Tìm user không phân biệt hoa thường
        const result = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
        const user = result.rows[0];
        
        if (!user) return res.status(400).json({ error: 'Invalid email or password' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: 'Invalid email or password' });

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({
            success: true,
            token,
            user: { 
                id: user.id, 
                email: user.email, 
                displayName: user.display_name, 
                avatar: user.avatar 
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/profile', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];

    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Invalid token' });
        
        const { displayName, avatar } = req.body;
        if (!displayName || !avatar) return res.status(400).json({ error: 'DisplayName and avatar required' });

        try {
            await db.query('UPDATE users SET display_name = $1, avatar = $2 WHERE id = $3', [displayName, avatar, decoded.id]);
            res.json({ success: true, user: { id: decoded.id, displayName, avatar } });
        } catch (updateErr) {
            res.status(500).json({ error: 'Database error' });
        }
    });
});

app.get('/api/leaderboard', async (req, res) => {
    const mode = parseInt(req.query.mode) || 1;
    const orderColumn = mode === 1 ? 'wins_mode1' : 'wins_mode2';
    
    try {
        const result = await db.query(`SELECT id, display_name, avatar, ${orderColumn} as wins FROM users ORDER BY ${orderColumn} DESC LIMIT 10`);
        const leaderboard = result.rows.map(r => ({
            id: r.id,
            displayName: r.display_name,
            avatar: r.avatar,
            wins: r.wins
        }));
        res.json({ success: true, leaderboard });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/history', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];

    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Invalid token' });
        
        const query = `
            SELECT m.*, 
                   u1.display_name as p1Name, u1.avatar as p1Avatar,
                   u2.display_name as p2Name, u2.avatar as p2Avatar
            FROM matches m
            LEFT JOIN users u1 ON m.p1_id = u1.id
            LEFT JOIN users u2 ON m.p2_id = u2.id
            WHERE m.p1_id = $1 OR m.p2_id = $2
            ORDER BY m.created_at DESC
            LIMIT 10
        `;
        try {
            const result = await db.query(query, [decoded.id, decoded.id]);
            const history = result.rows.map(r => ({
                id: r.id,
                mode: r.mode,
                p1Id: r.p1_id,
                p2Id: r.p2_id,
                p1Score: r.p1_score,
                p2Score: r.p2_score,
                winnerId: r.winner_id,
                createdAt: r.created_at,
                p1Name: r.p1name,
                p1Avatar: r.p1avatar,
                p2Name: r.p2name,
                p2Avatar: r.p2avatar
            }));
            res.json({ success: true, history });
        } catch (err) {
            res.status(500).json({ error: 'Database error' });
        }
    });
});

// --- Socket.io Setup ---
const gameManager = new GameManager(io, db);

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    
    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) return next(new Error('Authentication error'));
        
        try {
            const result = await db.query('SELECT id, email, display_name, avatar FROM users WHERE id = $1', [decoded.id]);
            const user = result.rows[0];
            if (!user) return next(new Error('User not found'));
            if (!user.display_name || !user.avatar) return next(new Error('Profile setup incomplete'));
            
            socket.user = { 
                id: user.id, 
                email: user.email, 
                displayName: user.display_name, 
                avatar: user.avatar 
            };
            next();
        } catch (dbErr) {
            next(new Error('Database error'));
        }
    });
});

io.on('connection', (socket) => {
    gameManager.handleConnection(socket);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
