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
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run('INSERT INTO users (email, password) VALUES (?, ?)', email, hashedPassword, function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Email already exists' });
                }
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true, message: 'Registration successful' });
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    db.all('SELECT * FROM users WHERE email = ?', email, async (err, rows) => {
        const user = rows && rows.length > 0 ? rows[0] : null;
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!user) return res.status(400).json({ error: 'Invalid email or password' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: 'Invalid email or password' });

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({
            success: true,
            token,
            user: { id: user.id, email: user.email, displayName: user.displayName, avatar: user.avatar }
        });
    });
});

app.post('/profile', (req, res) => {
    // Basic auth middleware logic inline for simplicity
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Invalid token' });
        
        const { displayName, avatar } = req.body;
        if (!displayName || !avatar) return res.status(400).json({ error: 'DisplayName and avatar required' });

        db.run('UPDATE users SET displayName = ?, avatar = ? WHERE id = ?', displayName, avatar, decoded.id, function(updateErr) {
            if (updateErr) return res.status(500).json({ error: 'Database error' });
            res.json({ success: true, user: { id: decoded.id, displayName, avatar } });
        });
    });
});
app.get('/api/leaderboard', (req, res) => {
    const mode = parseInt(req.query.mode) || 1;
    const orderColumn = mode === 1 ? 'winsMode1' : 'winsMode2';
    
    db.all(`SELECT id, displayName, avatar, ${orderColumn} as wins FROM users ORDER BY ${orderColumn} DESC LIMIT 10`, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true, leaderboard: rows });
    });
});

app.get('/api/history', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Invalid token' });
        
        const query = `
            SELECT m.*, 
                   u1.displayName as p1Name, u1.avatar as p1Avatar,
                   u2.displayName as p2Name, u2.avatar as p2Avatar
            FROM matches m
            LEFT JOIN users u1 ON m.p1Id = u1.id
            LEFT JOIN users u2 ON m.p2Id = u2.id
            WHERE m.p1Id = ? OR m.p2Id = ?
            ORDER BY m.createdAt DESC
            LIMIT 10
        `;
        db.all(query, decoded.id, decoded.id, (err, rows) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            res.json({ success: true, history: rows });
        });
    });
});

// --- Socket.io Setup ---
const gameManager = new GameManager(io);

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error('Authentication error'));
        
        // Fetch full user data to attach to socket
        db.all('SELECT id, email, displayName, avatar FROM users WHERE id = ?', decoded.id, (dbErr, rows) => {
            const user = rows && rows.length > 0 ? rows[0] : null;
            if (dbErr || !user) return next(new Error('User not found'));
            if (!user.displayName || !user.avatar) return next(new Error('Profile setup incomplete'));
            
            socket.user = user;
            next();
        });
    });
});

io.on('connection', (socket) => {
    gameManager.handleConnection(socket);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
