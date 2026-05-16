require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fs = require('fs');
const path = require('path');

function removeAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function getQuestionsFromJSON(count = 5, topicQuery = null) {
    try {
        const serverRoot = process.cwd();
        const topicsPath = path.join(serverRoot, 'data/topics.json');
        
        if (!fs.existsSync(topicsPath)) {
            const fallbackPath = path.join(__dirname, '../data/topics.json');
            if (fs.existsSync(fallbackPath)) {
                return getQuestionsFromJSONWithSpecificPath(fallbackPath, count, topicQuery);
            }
            console.warn("topics.json not found at:", topicsPath, "or", fallbackPath);
            return [];
        }
        return getQuestionsFromJSONWithSpecificPath(topicsPath, count, topicQuery);
    } catch (err) {
        console.error("Error reading questions from JSON:", err);
        return [];
    }
}

function getQuestionsFromJSONWithSpecificPath(topicsPath, count, topicQuery) {
    try {
        const dataDir = path.dirname(topicsPath);
        const topics = JSON.parse(fs.readFileSync(topicsPath, 'utf8'));
        let fileName = null;
        
        if (topicQuery) {
            const normalizedQuery = removeAccents(topicQuery.toLowerCase().trim());
            // Try exact match first
            let key = Object.keys(topics).find(k => removeAccents(k.toLowerCase()) === normalizedQuery);
            if (key) fileName = topics[key];
        } else {
            const keys = Object.keys(topics);
            if (keys.length === 0) return [];
            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            fileName = topics[randomKey];
        }

        if (!fileName) return [];

        const filePath = path.join(dataDir, fileName);
        if (!fs.existsSync(filePath)) {
            console.warn("Question file not found:", filePath);
            return [];
        }
        const data = fs.readFileSync(filePath, 'utf8');
        const questions = JSON.parse(data);
        return questions.sort(() => 0.5 - Math.random()).slice(0, count);
    } catch (e) {
        console.error("Error in getQuestionsFromJSONWithSpecificPath:", e);
        return [];
    }
}

async function generateQuestionsFromAI(topic, difficulty = "bình thường") {
    console.log(`[AI] Generating questions for: "${topic}" (Difficulty: ${difficulty})`);
    
    if (!process.env.GEMINI_API_KEY) {
        console.error("[AI] CRITICAL: GEMINI_API_KEY is missing!");
        return []; // Caller will handle fallback
    }

    try {
        const model = ai.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            generationConfig: {
                responseMimeType: "application/json",
            }
        });

        const prompt = `Bạn là một chuyên gia tạo câu hỏi trắc nghiệm. 
Hãy tạo đúng 5 câu hỏi trắc nghiệm về chủ đề cụ thể: "${topic}".
Yêu cầu:
1. Độ khó: ${difficulty}.
2. Ngôn ngữ: Tiếng Việt.
3. Nội dung phải chính xác, lôi cuốn và tập trung duy nhất vào "${topic}".
4. Trả về một mảng JSON: [{"q": "Câu hỏi?", "options": ["A", "B", "C", "D"], "a": index_đúng_từ_0_tới_3}, ...]`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
        
        if (text.includes('```json')) {
            text = text.split('```json')[1].split('```')[0].trim();
        } else if (text.includes('```')) {
            text = text.split('```')[1].split('```')[0].trim();
        }

        const data = JSON.parse(text);
        if (!Array.isArray(data) || data.length < 5) throw new Error("Invalid format or insufficient questions");
        return data.slice(0, 5);
    } catch (err) {
        console.error(`[AI] Error generating for "${topic}":`, err.message);
        return []; // Fail gracefully, caller handles fallback
    }
}




class GameManager {
    constructor(io, db) {
        this.io = io;
        this.db = db;
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
                    this.io.to(matchId).emit('match_state_update', this.getSafeMatchState(match));
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
                    this.io.to(matchId).emit('match_state_update', this.getSafeMatchState(match));
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
                        this.io.to(matchId).emit('match_state_update', this.getSafeMatchState(match));
                        this.io.to(matchId).emit('answer_result', { winnerId: opponentId, correctIndex: q.a, scores: match.scores, msg: "Trả lời sai! Đối thủ được cộng 1 điểm." });
                    }
                    setTimeout(() => this.nextQuestion(matchId), 1000);
                }
            }
        });

        socket.on('select_topic', async ({ matchId, topic, difficulty: explicitDifficulty }) => {
            const match = this.matches.get(matchId);
            if (!match || match.status !== 'waiting_topic') return;
            if (match.topicChooser !== socket.id) return;

            let finalTopic = topic.trim();
            let difficulty = explicitDifficulty || "bình thường";
            
            // Fallback: Extract difficulty hint if not explicitly provided
            if (!explicitDifficulty) {
                const lowerTopic = finalTopic.toLowerCase();
                if (lowerTopic.includes(' cực khó') || lowerTopic.includes(' rất khó')) {
                    difficulty = "cực khó, lắt léo";
                    finalTopic = finalTopic.replace(/ cực khó| rất khó/gi, '').trim();
                } else if (lowerTopic.includes(' khó')) {
                    difficulty = "khó";
                    finalTopic = finalTopic.replace(/ khó/gi, '').trim();
                } else if (lowerTopic.includes(' dễ')) {
                    difficulty = "dễ, cơ bản";
                    finalTopic = finalTopic.replace(/ dễ/gi, '').trim();
                }
            } else {
                // Ensure common terms are mapped to descriptive ones for AI
                if (difficulty === 'siêu khó') difficulty = 'siêu khó, cực kỳ lắt léo và chuyên sâu';
                if (difficulty === 'dễ') difficulty = 'dễ, kiến thức cơ bản';
            }

            match.currentTopic = topic; // Show full original input as topic name in UI
            match.status = 'generating';
            this.io.to(matchId).emit('match_state_update', this.getSafeMatchState(match));

            // Dùng JSON chỉ khi: Chủ đề khớp chính xác VÀ người dùng KHÔNG chọn mức độ cụ thể nào
            // Nếu người dùng chọn mức độ khó/dễ/siêu khó, luôn dùng AI để tạo đề phù hợp
            const isDefaultDifficulty = !explicitDifficulty || explicitDifficulty === 'bình thường';
            let useJSON = false;
            if (isDefaultDifficulty) {
                try {
                    const topicsPath = path.join(__dirname, '../data/topics.json');
                    if (fs.existsSync(topicsPath)) {
                        const topicsList = JSON.parse(fs.readFileSync(topicsPath, 'utf8'));
                        useJSON = Object.keys(topicsList).some(k => k.toLowerCase() === finalTopic.toLowerCase());
                    }
                } catch (e) {}
            }

            let questions = [];
            if (useJSON) {
                console.log(`[Game] Chủ đề khớp JSON, dùng file có sẵn: "${finalTopic}"`);
                questions = getQuestionsFromJSON(5, finalTopic);
            }

            if (questions.length < 5) {
                console.log(`[Game] Gọi AI tạo đề: "${finalTopic}" (Mức độ: ${difficulty})`);
                questions = await generateQuestionsFromAI(finalTopic, difficulty);
            }

            // Fallback cuối cùng nếu AI thất bại
            if (questions.length < 5) {
                console.log(`[Game] AI thất bại, lấy câu hỏi ngẫu nhiên từ JSON`);
                questions = getQuestionsFromJSON(5);
            }

            match.questions = questions;
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
            // Vòng 1 luôn dùng AI tạo đề theo yêu cầu
            generateQuestionsFromAI(randomTopic, true).then(q => {
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
        
        // Cập nhật trạng thái trận đấu (số câu hỏi hiện tại) cho client
        this.io.to(matchId).emit('match_state_update', this.getSafeMatchState(match));

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

    async endMatch(matchId) {
        const match = this.matches.get(matchId);
        if (!match) return;

        match.status = 'finished';
        let winnerSocketId = null;

        const p1 = match.players[0];
        const p2 = match.players[1];

        if (match.mode === 1) {
            if (match.scores[p1.socketId] > match.scores[p2.socketId]) winnerSocketId = p1.socketId;
            else if (match.scores[p2.socketId] > match.scores[p1.socketId]) winnerSocketId = p2.socketId;
        } else {
            if (match.roundWins[p1.socketId] > match.roundWins[p2.socketId]) winnerSocketId = p1.socketId;
            else if (match.roundWins[p2.socketId] > match.roundWins[p1.socketId]) winnerSocketId = p2.socketId;
        }

        const winner = winnerSocketId ? match.players.find(p => p.socketId === winnerSocketId) : null;
        
        console.log(`[Match] Finished. Mode: ${match.mode}, Winner: ${winner ? winner.displayName : 'Draw'}`);

        // --- Database Persistence ---
        if (this.db) {
            try {
                const p1 = match.players[0];
                const p2 = match.players[1];
                
                if (!p1.id || !p2.id) {
                    console.error("[DB] Missing user IDs for match recording!", { p1Id: p1.id, p2Id: p2.id });
                } else {
                    const p1Score = match.mode === 1 ? (match.scores[p1.socketId] || 0) : (match.roundWins[p1.socketId] || 0);
                    const p2Score = match.mode === 1 ? (match.scores[p2.socketId] || 0) : (match.roundWins[p2.socketId] || 0);
                    const winnerDbId = winner ? winner.id : null;

                    console.log(`[DB] Recording match: P1(${p1.id}) vs P2(${p2.id}), Scores: ${p1Score}-${p2Score}, Winner: ${winnerDbId}`);

                    // 1. Save match record
                    await this.db.query(
                        'INSERT INTO matches (mode, p1_id, p2_id, p1_score, p2_score, winner_id) VALUES ($1, $2, $3, $4, $5, $6)',
                        [match.mode, p1.id, p2.id, p1Score, p2Score, winnerDbId]
                    );

                    // 2. Update winner's win count
                    if (winnerDbId) {
                        const winsColumn = parseInt(match.mode) === 1 ? 'wins_mode1' : 'wins_mode2';
                        await this.db.query(
                            `UPDATE users SET ${winsColumn} = COALESCE(${winsColumn}, 0) + 1 WHERE id = $1`,
                            [winnerDbId]
                        );
                        console.log(`[DB] Successfully updated leaderboard for user ID: ${winnerDbId}`);
                    }
                }
            } catch (dbErr) {
                console.error("[DB] Error saving match results:", dbErr);
            }
        }

        this.io.to(matchId).emit('match_finished', { winner: winnerSocketId, finalState: this.getSafeMatchState(match) });
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
        let availableTopics = [];
        try {
            const serverRoot = process.cwd();
            let topicsPath = path.join(serverRoot, 'data/topics.json');
            
            if (!fs.existsSync(topicsPath)) {
                topicsPath = path.join(__dirname, '../data/topics.json');
            }

            if (fs.existsSync(topicsPath)) {
                availableTopics = Object.keys(JSON.parse(fs.readFileSync(topicsPath, 'utf8')));
            }
        } catch (e) {}

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
            currentQuestionIndex: match.currentQuestionIndex,
            topics: availableTopics,
            stars: match.stars,
            failedAttempts: match.failedAttempts
        };
    }
}

module.exports = GameManager;
