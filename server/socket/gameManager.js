require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);

function getAIClient() {
    if (apiKeys.length === 0) return null;
    const randomKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
    return new GoogleGenAI({ apiKey: randomKey });
}
const fs = require('fs');
const path = require('path');

function removeAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

async function generateQuestionsFromAI(topic, difficulty = "bình thường") {
    console.log(`[AI] Generating questions for: "${topic}" (Difficulty: ${difficulty})`);
    
    const aiClient = getAIClient();
    if (!aiClient) {
        console.error("[AI] CRITICAL: GEMINI_API_KEY is missing or invalid!");
        return []; // Caller will handle fallback
    }

    try {
        const prompt = `Bạn là một chuyên gia tạo câu hỏi trắc nghiệm tiếng Việt chất lượng cao, chuyên thiết kế các câu đố học thuật và trí tuệ.
Hãy tìm kiếm thông tin trên internet và tạo đúng 5 câu hỏi trắc nghiệm ĐỘC ĐÁO, cực kỳ THÚ VỊ, KHÓ, LẮT LÉO và mang tính thử thách cao về chủ đề cụ thể: "${topic}".
Yêu cầu:
1. Bạn phải sử dụng công cụ Google Search (grounding) để lấy các kiến thức chính xác, mới nhất và các chi tiết thú vị về chủ đề "${topic}".
2. Các câu hỏi này không được quá dễ, không dùng các kiến thức cơ bản phổ thông ai cũng biết. Hãy chọn các kiến thức chuyên sâu, thú vị, hoặc các câu hỏi đòi hỏi suy luận logic, phân tích kỹ lưỡng.
3. Phương án đúng và các phương án gây nhiễu (options) phải có tính đánh đố cao, tương tự nhau để người chơi dễ bị nhầm lẫn nếu không đọc kỹ hoặc không có kiến thức chắc chắn.
4. Ngôn ngữ: Tiếng Việt.

Yêu cầu định dạng JSON trả về:
Một mảng gồm chính xác 5 đối tượng có cấu trúc:
[
  {
    "q": "Nội dung câu hỏi trắc nghiệm lắt léo, thử thách?",
    "options": ["Phương án A", "Phương án B", "Phương án C", "Phương án D"],
    "a": 0, // Chỉ mục đáp án đúng trong mảng options (từ 0 tới 3)
    "difficulty": "khó"
  }
]`;

        const response = await aiClient.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }],
                responseMimeType: "application/json"
            }
        });

        let text = response.text;
        
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
        
        // Cache câu hỏi toàn cục để đáp ứng nhanh (Hybrid Cache)
        this.questionsCache = {}; 
        this.loadQuestionsToCache();
    }

    async loadQuestionsToCache() {
        if (!this.db) {
            console.warn("⚠️ [Cache] Kết nối Database Supabase không khả dụng.");
            return;
        }
        try {
            console.log("⚡ [Cache] Đang tải toàn bộ câu hỏi từ Supabase vào RAM...");
            const res = await this.db.query('SELECT * FROM questions');
            
            this.questionsCache = {};
            
            res.rows.forEach(row => {
                const topicName = row.topic.trim();
                const topicLower = topicName.toLowerCase();
                
                if (!this.questionsCache[topicLower]) {
                    this.questionsCache[topicLower] = {
                        name: topicName,
                        list: []
                    };
                }
                
                this.questionsCache[topicLower].list.push({
                    q: row.q,
                    options: row.options,
                    a: row.a,
                    difficulty: row.difficulty
                });
            });
            
            const summary = Object.keys(this.questionsCache).map(k => {
                return `"${this.questionsCache[k].name}": ${this.questionsCache[k].list.length} câu`;
            }).join(', ');
            
            console.log(`⚡ [Cache] Đã đồng bộ câu hỏi vào RAM thành công! (${summary})`);
        } catch (err) {
            console.error("❌ [Cache] Lỗi khi tải câu hỏi từ Supabase vào RAM:", err.message);
        }
    }

    getQuestionsFromCache(topic, count = 5) {
        const topicLower = topic.toLowerCase().trim();
        const cacheEntry = this.questionsCache[topicLower];
        if (!cacheEntry || !cacheEntry.list || cacheEntry.list.length === 0) {
            console.warn(`⚠️ [Cache] Không tìm thấy câu hỏi cho chủ đề: "${topic}"`);
            return [];
        }
        // Trộn ngẫu nhiên câu hỏi
        const shuffled = [...cacheEntry.list].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
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
            
            // Fallback: Trích xuất độ khó từ gợi ý tiêu đề nếu không được chọn trực tiếp
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
                if (difficulty === 'siêu khó') difficulty = 'siêu khó, cực kỳ lắt léo và chuyên sâu';
                if (difficulty === 'dễ') difficulty = 'dễ, kiến thức cơ bản';
            }

            match.currentTopic = topic;
            match.status = 'generating';
            this.io.to(matchId).emit('match_state_update', this.getSafeMatchState(match));

            // Chỉ dùng câu hỏi từ Cache nếu người dùng chọn độ khó mặc định
            const isDefaultDifficulty = !explicitDifficulty || explicitDifficulty === 'bình thường';
            let useCache = false;
            if (isDefaultDifficulty) {
                const topicLower = finalTopic.toLowerCase().trim();
                useCache = !!this.questionsCache[topicLower];
            }

            let questions = [];
            if (useCache) {
                console.log(`[Game] Chủ đề khớp cache, lấy từ RAM: "${finalTopic}"`);
                questions = this.getQuestionsFromCache(finalTopic, 5);
            }

            // Nếu không có trong cache hoặc chọn độ khó khác, dùng AI để sinh đề
            if (questions.length < 5) {
                console.log(`[Game] Gọi AI tạo đề: "${finalTopic}" (Mức độ: ${difficulty})`);
                questions = await generateQuestionsFromAI(finalTopic, difficulty);

                // Lưu câu hỏi vào database và đồng bộ vào cache RAM để tăng độ phong phú
                if (questions.length === 5) {
                    console.log(`[AI] Tạo thành công 5 câu hỏi cho "${finalTopic}". Đang tiến hành lưu trữ vào database...`);
                    if (this.db) {
                        for (const q of questions) {
                            try {
                                // Kiểm tra trùng lặp trước khi chèn
                                const check = await this.db.query('SELECT id FROM questions WHERE topic = $1 AND q = $2', [finalTopic, q.q]);
                                if (check.rows.length === 0) {
                                    await this.db.query(
                                        'INSERT INTO questions (topic, q, options, a, difficulty) VALUES ($1, $2, $3, $4, $5)',
                                        [finalTopic, q.q, q.options, q.a, difficulty]
                                    );
                                    console.log(`[DB] Đã lưu câu hỏi mới: "${q.q}"`);
                                }
                            } catch (dbErr) {
                                console.error(`[DB] Lỗi khi lưu câu hỏi của "${finalTopic}":`, dbErr.message);
                            }
                        }
                    }
                    
                    // Đồng bộ ngay lập tức vào cache RAM
                    const topicLower = finalTopic.toLowerCase().trim();
                    if (!this.questionsCache[topicLower]) {
                        TopicCache: this.questionsCache[topicLower] = {
                            name: finalTopic,
                            list: []
                        };
                    }
                    for (const q of questions) {
                        const isDuplicate = this.questionsCache[topicLower].list.some(existing => existing.q === q.q);
                        if (!isDuplicate) {
                            this.questionsCache[topicLower].list.push({
                                q: q.q,
                                options: q.options,
                                a: q.a,
                                difficulty: difficulty
                            });
                        }
                    }
                    console.log(`[Cache] Đã đồng bộ 5 câu hỏi mới của "${finalTopic}" vào RAM cache.`);
                }
            }

            // Fallback cuối cùng nếu AI thất bại: Lấy ngẫu nhiên từ Cache
            if (questions.length < 5) {
                console.log(`[Game] AI thất bại, lấy câu hỏi ngẫu nhiên từ Cache RAM`);
                const cacheKeys = Object.keys(this.questionsCache);
                if (cacheKeys.length > 0) {
                    const randomKey = cacheKeys[Math.floor(Math.random() * cacheKeys.length)];
                    questions = this.getQuestionsFromCache(randomKey, 5);
                }
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

        // Lấy danh sách các chủ đề đang có trong Cache RAM làm chủ đề ngẫu nhiên ban đầu
        let availableTopics = ['Lịch sử Việt Nam', 'Địa lý Việt Nam', 'Văn học Việt Nam', 'Khoa học', 'Thể thao'];
        const cacheKeys = Object.keys(this.questionsCache);
        if (cacheKeys.length > 0) {
            availableTopics = cacheKeys.map(k => this.questionsCache[k].name);
        }
        
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
            questions: [], 
            prefetchedQuestions: null, 
            round: 1,
            roundWins: { [p1]: 0, [p2]: 0 },
            topicChooser: null,
            stars: { [p1]: 1, [p2]: 1 },
            failedAttempts: []
        };

        if (mode === 1 || mode === 2) {
            // Lấy ngay 5 câu hỏi ngẫu nhiên từ Cache để trận đấu bắt đầu tức thì (0ms)
            const q = this.getQuestionsFromCache(randomTopic, 5);
            match.prefetchedQuestions = q;
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
        // Lấy danh sách các chủ đề khả dụng trực tiếp từ Cache RAM
        let availableTopics = ['Lịch sử Việt Nam', 'Địa lý Việt Nam', 'Văn học Việt Nam', 'Khoa học', 'Thể thao'];
        const cacheKeys = Object.keys(this.questionsCache);
        if (cacheKeys.length > 0) {
            availableTopics = cacheKeys.map(k => this.questionsCache[k].name);
        }

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
