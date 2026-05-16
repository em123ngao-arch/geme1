require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const fs = require('fs');
const path = require('path');

function getQuestionsFromJSON(count = 5, topic = null) {
    try {
        const topicsPath = path.join(__dirname, '../data/topics.json');
        if (!fs.existsSync(topicsPath)) return [];
        const topics = JSON.parse(fs.readFileSync(topicsPath, 'utf8'));

        let fileName = topics[topic];
        
        // Nếu không có topic cụ thể hoặc không tìm thấy, chọn ngẫu nhiên một chủ đề có sẵn
        if (!fileName) {
            const keys = Object.keys(topics);
            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            fileName = topics[randomKey];
        }

        const filePath = path.join(__dirname, '../data', fileName);
        if (!fs.existsSync(filePath)) return [];
        const data = fs.readFileSync(filePath, 'utf8');
        const questions = JSON.parse(data);
        
        return questions.sort(() => 0.5 - Math.random()).slice(0, count);
    } catch (err) {
        console.error("Error reading questions from JSON:", err);
        return [];
    }
}

async function generateQuestionsFromAI(topic) {
    // Ưu tiên lấy từ JSON trước
    const localQuestions = getQuestionsFromJSON(5, topic);
    if (localQuestions.length >= 5) {
        return localQuestions;
    }

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Tạo 5 câu hỏi trắc nghiệm cực khó, lắt léo về chủ đề "${topic}" bằng tiếng Việt.
Trả về DUY NHẤT một mảng JSON, không có chữ text nào khác, không dùng markdown block (không dùng \`\`\`json).
Cấu trúc: [{"q": "Câu hỏi?", "options": ["A", "B", "C", "D"], "a": index_đúng_từ_0_tới_3}, ...]`,
            config: {
                responseMimeType: "application/json",
            }
        });

        let text = response.text;
        if (text.startsWith('```json')) text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        else if (text.startsWith('```')) text = text.replace(/```/g, '').trim();

        const data = JSON.parse(text);
        if (!Array.isArray(data) || data.length < 5) throw new Error("Invalid format");
        return data.slice(0, 5);
    } catch (err) {
        console.error("AI Generation Error:", err);
        const fallback = getQuestionsFromJSON(5);
        if (fallback.length > 0) return fallback;
        
        return [
            { q: `Câu hỏi mẫu về ${topic} (Do lỗi kết nối AI)?`, options: ["Đúng", "Sai", "A", "B"], a: 0 },
            { q: "1 + 1 bằng mấy?", options: ["2", "3", "4", "5"], a: 0 },
            { q: "Màu của bầu trời là?", options: ["Xanh", "Đỏ", "Tím", "Vàng"], a: 0 },
            { q: "Động vật nào kêu meo meo?", options: ["Mèo", "Chó", "Lợn", "Gà"], a: 0 },
            { q: "Thủ đô của Việt Nam?", options: ["Hà Nội", "Hồ Chí Minh", "Đà Nẵng", "Cần Thơ"], a: 0 },
        ];
    }
}




class GameManager {
    constructor(io) {
        this.io = io;
        this.onlineUsers = new Map(); // socket.id -> user profile
        this.queueMode1 = []; // socket.id
        this.queueMode2 = []; // socket.id
        this.matches = new Map(); // matchId -> matchState
    }

    handleConnection(socket) {
        this.onlineUsers.set(socket.id, socket.user);
        this.broadcastOnlineCount();

        socket.on('disconnect', () => {
            this.onlineUsers.delete(socket.id);
            this.queueMode1 = this.queueMode1.filter(id => id !== socket.id);
            this.queueMode2 = this.queueMode2.filter(id => id !== socket.id);
            this.broadcastOnlineCount();

            // Handle if user was in a match
            this.handlePlayerDisconnect(socket.id);
        });

        socket.on('chat_message', (msg) => {
            this.io.emit('chat_message', {
                sender: socket.user.displayName,
                text: msg,
                time: new Date().toISOString()
            });
        });

        socket.on('join_queue', ({ mode }) => {
            if (mode === 1) {
                if (!this.queueMode1.includes(socket.id)) this.queueMode1.push(socket.id);
                this.checkQueue(1);
            } else if (mode === 2) {
                if (!this.queueMode2.includes(socket.id)) this.queueMode2.push(socket.id);
                this.checkQueue(2);
            }
        });

        socket.on('leave_queue', () => {
            this.queueMode1 = this.queueMode1.filter(id => id !== socket.id);
            this.queueMode2 = this.queueMode2.filter(id => id !== socket.id);
        });

        socket.on('player_ready', async ({ matchId }) => {
            const match = this.matches.get(matchId);
            if (match) {
                match.ready[socket.id] = true;
                this.io.to(matchId).emit('match_state_update', this.getSafeMatchState(match));

                if (Object.values(match.ready).every(v => v === true)) {
                    if (match.mode === 1 || (match.mode === 2 && match.round === 1)) {
                        if (match.prefetchedQuestions) {
                            match.questions = match.prefetchedQuestions;
                            this.startCountdown(matchId);
                        } else {
                            match.status = 'generating';
                            this.io.to(matchId).emit('match_state_update', this.getSafeMatchState(match));

                            const checkInterval = setInterval(() => {
                                if (match.prefetchedQuestions) {
                                    clearInterval(checkInterval);
                                    match.questions = match.prefetchedQuestions;
                                    this.startCountdown(matchId);
                                }
                            }, 300);
                        }
                    } else {
                        // Round > 1 has waiting_topic phase instead
                        this.startCountdown(matchId);
                    }
                }
            }
        });

        socket.on('submit_answer', ({ matchId, questionIndex, answerIndex, useStar }) => {
            const match = this.matches.get(matchId);
            if (!match || match.status !== 'playing' || match.currentQuestionIndex !== questionIndex) return;
            if (match.questionResolved) return;

            // Check if player is already locked out (failed attempt)
            if (match.failedAttempts.includes(socket.id)) return;

            const q = match.questions[match.currentQuestionIndex];
            const p1 = match.players[0].socketId;
            const p2 = match.players[1].socketId;
            const opponentId = p1 === socket.id ? p2 : p1;

            if (useStar && match.stars[socket.id] > 0) {
                match.stars[socket.id] -= 1;

                if (answerIndex === q.a) {
                    match.questionResolved = true;
                    clearTimeout(match.timerId);
                    match.scores[socket.id] += 2;
                    this.io.to(matchId).emit('answer_result', { winnerId: socket.id, correctIndex: q.a, scores: match.scores, msg: "Đúng với Ngôi sao hy vọng (+2 điểm)!" });
                    setTimeout(() => this.nextQuestion(matchId), 1000);
                } else {
                    // Used star but wrong -> block this player, give opponent a chance
                    match.failedAttempts.push(socket.id);
                    this.io.to(matchId).emit('match_state_update', this.getSafeMatchState(match)); // to update UI
                }
            } else {
                // Not using star (or no stars left)
                if (answerIndex === q.a) {
                    match.questionResolved = true;
                    clearTimeout(match.timerId);
                    match.scores[socket.id] += 1;
                    this.io.to(matchId).emit('answer_result', { winnerId: socket.id, correctIndex: q.a, scores: match.scores });
                    setTimeout(() => this.nextQuestion(matchId), 1000);
                } else {
                    // Wrong without star
                    match.questionResolved = true;
                    clearTimeout(match.timerId);

                    if (match.failedAttempts.length > 0) {
                        // The opponent used a star and failed, now this player also failed
                        this.io.to(matchId).emit('answer_result', { winnerId: null, correctIndex: q.a, scores: match.scores, msg: "Cả hai đều trả lời sai!" });
                    } else {
                        // This player failed first -> Opponent gets point automatically
                        match.scores[opponentId] += 1;
                        this.io.to(matchId).emit('answer_result', { winnerId: opponentId, correctIndex: q.a, scores: match.scores, msg: "Trả lời sai! Đối thủ được cộng 1 điểm." });
                    }
                    setTimeout(() => this.nextQuestion(matchId), 1000);
                }
            }
        });

        socket.on('select_topic', async ({ matchId, topic }) => {
            const match = this.matches.get(matchId);
            if (!match || match.status !== 'waiting_topic') return;
            // Ensure correct player is choosing
            if (match.topicChooser !== socket.id) return;

            match.currentTopic = topic;
            match.status = 'generating';
            this.io.to(matchId).emit('match_state_update', this.getSafeMatchState(match));

            match.questions = await generateQuestionsFromAI(topic);
            match.currentQuestionIndex = -1;

            this.startCountdown(matchId);
        });
    }

    broadcastOnlineCount() {
        this.io.emit('online_count', this.onlineUsers.size);
    }

    checkQueue(mode) {
        const queue = mode === 1 ? this.queueMode1 : this.queueMode2;
        if (queue.length >= 2) {
            const p1 = queue.shift();
            const p2 = queue.shift();
            this.createMatch(p1, p2, mode);
        }
    }

    createMatch(p1, p2, mode) {
        const matchId = require('crypto').randomBytes(8).toString('hex');

        const p1User = { ...this.onlineUsers.get(p1), socketId: p1 };
        const p2User = { ...this.onlineUsers.get(p2), socketId: p2 };

        let availableTopics = ['Lịch sử Việt Nam', 'Địa lý Việt Nam', 'Văn học Việt Nam', 'Khoa học', 'Thể thao'];
        try {
            const topicsPath = path.join(__dirname, '../data/topics.json');
            if (fs.existsSync(topicsPath)) {
                availableTopics = Object.keys(JSON.parse(fs.readFileSync(topicsPath, 'utf8')));
            }
        } catch (e) {}
        
        const randomTopic = availableTopics[Math.floor(Math.random() * availableTopics.length)];

        const match = {
            id: matchId,
            mode,
            players: [p1User, p2User],
            scores: { [p1]: 0, [p2]: 0 },
            ready: { [p1]: false, [p2]: false },
            status: 'waiting_ready',
            currentQuestionIndex: -1,
            currentTopic: randomTopic,
            questions: [], // generated later
            prefetchedQuestions: null, // to speed up start
            round: 1,
            roundWins: { [p1]: 0, [p2]: 0 },
            topicChooser: null,
            stars: { [p1]: 1, [p2]: 1 },
            failedAttempts: []
        };

        if (mode === 1 || mode === 2) {
            generateQuestionsFromAI(randomTopic).then(q => {
                const m = this.matches.get(matchId);
                if (m) m.prefetchedQuestions = q;
            });
        }

        this.matches.set(matchId, match);

        const s1 = this.io.sockets.sockets.get(p1);
        const s2 = this.io.sockets.sockets.get(p2);
        if (s1) s1.join(matchId);
        if (s2) s2.join(matchId);

        this.io.to(matchId).emit('match_found', this.getSafeMatchState(match));
    }

    startCountdown(matchId) {
        const match = this.matches.get(matchId);
        if (!match) return;

        match.status = 'countdown';
        this.io.to(matchId).emit('match_state_update', this.getSafeMatchState(match));

        let count = 5;
        const interval = setInterval(() => {
            count--;
            if (count > 0) {
                this.io.to(matchId).emit('countdown_tick', count);
            } else {
                clearInterval(interval);
                match.status = 'playing';
                this.io.to(matchId).emit('match_state_update', this.getSafeMatchState(match));
                this.nextQuestion(matchId);
            }
        }, 1000);
    }

    nextQuestion(matchId) {
        const match = this.matches.get(matchId);
        if (!match) return;

        match.currentQuestionIndex++;
        match.questionResolved = false;
        match.failedAttempts = [];

        if (match.mode === 1) {
            // Solo mode: First to 3 wins, or max 5 questions
            const p1 = match.players[0].socketId;
            const p2 = match.players[1].socketId;

            if (match.scores[p1] >= 3 || match.scores[p2] >= 3 || match.currentQuestionIndex >= 5) {
                return this.endMatch(matchId);
            }
        } else if (match.mode === 2) {
            if (match.currentQuestionIndex >= 5) {
                return this.endRound(matchId);
            }
        }

        const q = match.questions[match.currentQuestionIndex];
        // Send question without answer
        this.io.to(matchId).emit('new_question', {
            index: match.currentQuestionIndex,
            q: q.q,
            options: q.options,
            timeLimit: 20
        });

        match.timerId = setTimeout(() => {
            if (!match.questionResolved) {
                match.questionResolved = true;
                this.io.to(matchId).emit('answer_result', { winnerId: null, correctIndex: q.a, scores: match.scores, msg: "Hết giờ!" });
                setTimeout(() => this.nextQuestion(matchId), 1000);
            }
        }, 20000);
    }

    endRound(matchId) {
        const match = this.matches.get(matchId);
        if (!match) return;

        const p1 = match.players[0].socketId;
        const p2 = match.players[1].socketId;

        if (match.scores[p1] > match.scores[p2]) match.roundWins[p1]++;
        else if (match.scores[p2] > match.scores[p1]) match.roundWins[p2]++;

        match.round++;
        match.stars = { [p1]: 1, [p2]: 1 };
        match.failedAttempts = [];

        if (match.roundWins[p1] >= 2 || match.roundWins[p2] >= 2 || match.round > 3) {
            return this.endMatch(matchId);
        }

        // Reset scores for next round
        match.scores[p1] = 0;
        match.scores[p2] = 0;
        match.status = 'waiting_topic';

        if (match.round === 2) match.topicChooser = p1;
        if (match.round === 3) match.topicChooser = p2;

        this.io.to(matchId).emit('match_state_update', this.getSafeMatchState(match));
    }

    endMatch(matchId) {
        const match = this.matches.get(matchId);
        if (!match) return;

        match.status = 'finished';
        let winner = null;

        const p1 = match.players[0].socketId;
        const p2 = match.players[1].socketId;

        if (match.mode === 1) {
            if (match.scores[p1] > match.scores[p2]) winner = p1;
            else if (match.scores[p2] > match.scores[p1]) winner = p2;
        } else {
            if (match.roundWins[p1] > match.roundWins[p2]) winner = p1;
            else if (match.roundWins[p2] > match.roundWins[p1]) winner = p2;
        }

        this.io.to(matchId).emit('match_finished', { winner, finalState: this.getSafeMatchState(match) });
        this.matches.delete(matchId);
    }

    handlePlayerDisconnect(socketId) {
        for (const [matchId, match] of this.matches.entries()) {
            if (match.players.some(p => p.socketId === socketId)) {
                this.io.to(matchId).emit('opponent_disconnected');
                this.matches.delete(matchId);
            }
        }
    }

    getSafeMatchState(match) {
        return {
            id: match.id,
            mode: match.mode,
            players: match.players,
            scores: match.scores,
            ready: match.ready,
            status: match.status,
            round: match.round,
            roundWins: match.roundWins,
            topicChooser: match.topicChooser,
            currentTopic: match.currentTopic,
            topics: [],
            stars: match.stars,
            failedAttempts: match.failedAttempts
        };
    }
}

module.exports = GameManager;
