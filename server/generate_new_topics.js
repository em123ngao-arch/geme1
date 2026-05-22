const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./db');
const { GoogleGenAI } = require('@google/genai');

const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);

if (apiKeys.length === 0) {
    console.error("❌ Không tìm thấy GEMINI_API_KEY trong file .env!");
    process.exit(1);
}

let currentKeyIndex = 0;
function getAiClient() {
    return new GoogleGenAI({ apiKey: apiKeys[currentKeyIndex] });
}

function rotateApiKey() {
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    console.log(`🔄 Có lỗi hoặc chạm giới hạn! Đang xoay vòng sang API Key #${currentKeyIndex + 1} (${apiKeys[currentKeyIndex].substring(0, 8)}...)`);
}

const tasks = [
    { topic: "Python", difficulty: "bình thường", count: 50 },
    { topic: "Java", difficulty: "bình thường", count: 50 },
    { topic: "Ngôn ngữ Hàn quốc", difficulty: "bình thường", count: 50 },
    { topic: "Nhóm nhạc BTS", difficulty: "dễ", count: 50 },
    { topic: "Nhóm nhạc BTS", difficulty: "bình thường", count: 50 }
];

async function generateBatch(topic, difficulty, count) {
    const prompt = `Bạn là một chuyên gia tạo câu hỏi trắc nghiệm tiếng Việt chất lượng cao.
Hãy tạo đúng ${count} câu hỏi trắc nghiệm ĐỘC ĐÁO, chính xác và hay về chủ đề: "${topic}".
Yêu cầu:
1. Độ khó của toàn bộ câu hỏi phải là: "${difficulty}".
   - Nếu là "dễ": Các câu hỏi cơ bản, dễ trả lời, phổ biến.
   - Nếu là "bình thường" (trung bình): Các câu hỏi đòi hỏi kiến thức trung bình, không quá dễ nhưng không quá đánh đố.
2. Với chủ đề lập trình như Python/Java, hãy hỏi về cú pháp, thư viện, kết quả đoạn code hoặc khái niệm cơ bản đến trung bình.
3. Với chủ đề "Ngôn ngữ Hàn quốc", hãy hỏi về ngữ pháp cơ bản, từ vựng, cách dùng từ hoặc các câu giao tiếp trung bình.
4. Với "Nhóm nhạc BTS", hãy hỏi về các thành viên, bài hát, album, năm ra mắt, các cột mốc giải thưởng của nhóm phù hợp độ khó yêu cầu.
5. Ngôn ngữ: Tiếng Việt.

Yêu cầu định dạng JSON trả về:
Một mảng gồm chính xác ${count} đối tượng có cấu trúc:
[
  {
    "q": "Nội dung câu hỏi trắc nghiệm?",
    "options": ["Phương án A", "Phương án B", "Phương án C", "Phương án D"],
    "a": 0, // Chỉ mục đáp án đúng trong mảng options (từ 0 tới 3)
    "difficulty": "${difficulty}"
  },
  ...
]`;

    let attempts = 0;
    const maxAttempts = apiKeys.length * 2; // Thử tối đa 2 vòng hết tất cả các key
    
    while (attempts < maxAttempts) {
        try {
            const aiClient = getAiClient();
            const response = await aiClient.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json"
                }
            });

            const rawText = response.text.trim();
            let text = rawText;
            
            let data;
            try {
                // Thử parse JSON trực tiếp trước tiên
                data = JSON.parse(text);
            } catch (jsonErr) {
                // Nếu lỗi, thử bóc tách markdown block
                if (text.includes('```json')) {
                    text = text.split('```json')[1].split('```')[0].trim();
                } else if (text.includes('```')) {
                    text = text.split('```')[1].split('```')[0].trim();
                }
                data = JSON.parse(text);
            }

            if (!Array.isArray(data)) throw new Error("Kết quả từ Gemini không phải là mảng JSON");
            return data;
        } catch (e) {
            console.error(`❌ Lỗi sinh câu hỏi cho ${topic} (${difficulty}) ở lượt thử thứ ${attempts + 1}:`, e.message);
            rotateApiKey();
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    return [];
}

async function run() {
    console.log("🚀 Bắt đầu sinh câu hỏi tự động cho 3 chủ đề lớn mới...");
    
    // Chờ db init xong
    await new Promise(resolve => setTimeout(resolve, 2000));

    for (const task of tasks) {
        console.log(`\n--- Sinh đề: "${task.topic}" - Độ khó: "${task.difficulty}" (Cần ${task.count} câu) ---`);
        
        // Kiểm tra xem hiện tại đã có bao nhiêu câu hỏi khớp trong DB rồi
        const checkCountRes = await db.query(
            'SELECT COUNT(*) FROM questions WHERE topic = $1 AND difficulty = $2',
            [task.topic, task.difficulty]
        );
        let existing = parseInt(checkCountRes.rows[0].count);
        console.log(`Đang có ${existing}/${task.count} câu trong DB.`);

        while (existing < task.count) {
            const needed = task.count - existing;
            const batchSize = Math.min(25, needed); // Sinh theo lô 25 câu để an toàn

            console.log(`👉 Đang sinh thêm lô ${batchSize} câu...`);
            const questions = await generateBatch(task.topic, task.difficulty, batchSize);

            if (!questions || questions.length === 0) {
                console.log(`⚠️ Không sinh được câu hỏi nào ở lô này. Chờ 10 giây trước khi thử lại...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
                continue;
            }

            let added = 0;
            for (const q of questions) {
                if (!q.q || !Array.isArray(q.options) || q.options.length !== 4 || typeof q.a !== 'number') {
                    continue;
                }

                // Check trùng lặp
                const dupCheck = await db.query(
                    'SELECT id FROM questions WHERE topic = $1 AND q = $2',
                    [task.topic, q.q]
                );
                
                if (dupCheck.rows.length === 0) {
                    await db.query(
                        'INSERT INTO questions (topic, q, options, a, difficulty) VALUES ($1, $2, $3, $4, $5)',
                        [task.topic, q.q, q.options, q.a, task.difficulty]
                    );
                    added++;
                }
            }

            existing += added;
            console.log(`✅ Đã thêm thành công ${added} câu. Hiện có: ${existing}/${task.count}`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Tránh rate limit
        }
        console.log(`✔ Hoàn thành chủ đề "${task.topic}" - "${task.difficulty}"!`);
    }

    console.log("\n🎉 HOÀN THÀNH TẤT CẢ CÁC NHIỆM VỤ SINH ĐỀ!");
    db.end();
}

run();
