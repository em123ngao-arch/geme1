const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const db = require('./db');
const { GoogleGenAI } = require('@google/genai');

// Hỗ trợ cả 1 key hoặc nhiều key ngăn cách bằng dấu phẩy
const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);

if (apiKeys.length === 0) {
    console.error("❌ Không tìm thấy GEMINI_API_KEY trong file .env!");
    process.exit(1);
}

console.log(`🔑 Tìm thấy ${apiKeys.length} API Key(s) để hoạt động.`);

// Tạo các client AI tương ứng với từng key
const aiClients = apiKeys.map(key => new GoogleGenAI({ apiKey: key }));
let currentKeyIndex = 0;
let globalConsecutiveFailures = 0;

// Hàm lấy client AI xoay vòng tiếp theo
function getNextAIClient() {
    const client = aiClients[currentKeyIndex];
    const keyAbbr = apiKeys[currentKeyIndex].substring(0, 8) + '...';
    // Xoay index
    currentKeyIndex = (currentKeyIndex + 1) % aiClients.length;
    return { client, keyAbbr };
}

// Cấu hình 10 chủ đề (Chủ đề thứ 10 là "Toán học & Logic" được sinh mới hoàn toàn)
const topics = {
  "Lịch sử Việt Nam": "lich-su-viet-nam.json",
  "Địa lý Việt Nam": "dia-ly-viet-nam.json",
  "Văn học Việt Nam": "van-hoc-viet-nam.json",
  "Khoa học": "khoa-hoc.json",
  "Thể thao": "the-thao.json",
  "Văn hóa & Nghệ thuật": "van-hoa-nghe-thuat.json",
  "Công nghệ & Kỹ thuật": "cong-nghe-ky-thuat.json",
  "Ẩm thực Việt Nam": "am-thuc-viet-nam.json",
  "Giải trí & Phim ảnh": "giai-tri-phim-anh.json",
  "Toán học & Logic": null // Chủ đề sinh mới 100% từ AI
};

const TARGET_QUESTIONS_PER_TOPIC = 500; // Mỗi chủ đề cần 500 câu hỏi
const BATCH_SIZE = 25; // Mỗi lần gọi AI sinh 25 câu hỏi để tối ưu tốc độ và tránh quá giới hạn Token

async function getExistingQuestionsCount(topic) {
    const res = await db.query('SELECT COUNT(*) FROM questions WHERE topic = $1', [topic]);
    return parseInt(res.rows[0].count);
}

async function importJSONQuestions() {
    console.log("--- BẮT ĐẦU DI CHUYỂN DỮ LIỆU TỪ CÁC FILE JSON HIỆN CÓ ---");
    for (const [topic, fileName] of Object.entries(topics)) {
        if (!fileName) continue; // Bỏ qua chủ đề mới không có file JSON
        const filePath = path.join(__dirname, 'data', fileName);
        if (!fs.existsSync(filePath)) {
            console.warn(`⚠️  File ${filePath} không tồn tại. Bỏ qua import.`);
            continue;
        }
        try {
            const questions = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            let importedCount = 0;
            for (const item of questions) {
                // Kiểm tra xem câu hỏi này đã được chèn vào DB trước đó chưa
                const check = await db.query('SELECT id FROM questions WHERE topic = $1 AND q = $2', [topic, item.q]);
                if (check.rows.length === 0) {
                    await db.query(
                        'INSERT INTO questions (topic, q, options, a, difficulty) VALUES ($1, $2, $3, $4, $5)',
                        [topic, item.q, item.options, item.a, item.difficulty || 'bình thường']
                    );
                    importedCount++;
                }
            }
            console.log(`[${topic}] Đã di chuyển thành công ${importedCount} câu hỏi cũ từ file JSON vào Supabase.`);
        } catch (e) {
            console.error(`❌ Lỗi khi đọc/import file ${fileName}:`, e.message);
        }
    }
}

async function generateQuestionsBatch(topic, currentCount, batchSize, workerId) {
    // Lấy client tiếp theo từ danh sách xoay vòng
    const { client, keyAbbr } = getNextAIClient();
    console.log(`[Worker ${workerId}] [${topic}] Yêu cầu tạo ${batchSize} câu hỏi (Có ${currentCount}/${TARGET_QUESTIONS_PER_TOPIC}) | Sử dụng Key: ${keyAbbr}`);

    const prompt = `Bạn là một chuyên gia tạo câu hỏi trắc nghiệm tiếng Việt chất lượng cao, chuyên thiết kế các câu đố học thuật và trí tuệ.
Hãy tạo đúng ${batchSize} câu hỏi trắc nghiệm ĐỘC ĐÁO, cực kỳ THÚ VỊ, KHÓ, LẮT LÉO và mang tính thử thách cao về chủ đề cụ thể: "${topic}".
Yêu cầu:
1. Các câu hỏi này không được quá dễ, không dùng các kiến thức cơ bản phổ thông ai cũng biết. Hãy chọn các kiến thức chuyên sâu, thú vị, hoặc các câu hỏi đòi hỏi suy luận logic, phân tích kỹ lưỡng.
2. Phương án đúng và các phương án gây nhiễu (options) phải có tính đánh đố cao, tương tự nhau để người chơi dễ bị nhầm lẫn nếu không đọc kỹ hoặc không có kiến thức chắc chắn.
3. Với chủ đề "Toán học & Logic", hãy tạo các bài toán đố vui logic phức tạp, chuỗi quy luật số học tinh vi, đố mẹo thông minh, đòi hỏi mức độ tư duy xuất sắc.
4. Với các chủ đề khác như "Giải trí & Phim ảnh", hãy hỏi về các chi tiết thú vị, ít người biết, hậu trường, hoặc các cột mốc lắt léo trong lịch sử điện ảnh/âm nhạc thế giới và Việt Nam.

Yêu cầu định dạng JSON trả về:
Một mảng gồm chính xác ${batchSize} đối tượng có cấu trúc:
[
  {
    "q": "Nội dung câu hỏi trắc nghiệm lắt léo, thử thách?",
    "options": ["Phương án A", "Phương án B", "Phương án C", "Phương án D"],
    "a": 0, // Chỉ mục đáp án đúng trong mảng options (từ 0 tới 3)
    "difficulty": "khó" // Đặt giá trị là "khó" hoặc "bình thường" (TUYỆT ĐỐI KHÔNG tạo câu hỏi mức độ "dễ")
  },
  ...
]`;

    const candidateModels = ["gemini-3.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash"];
    let response = null;
    let lastErr = null;
    
    for (const modelName of candidateModels) {
        try {
            response = await client.models.generateContent({
                model: modelName,
                contents: prompt,
                config: {
                    responseMimeType: "application/json"
                }
            });
            if (response) {
                break;
            }
        } catch (err) {
            lastErr = err;
            console.log(`⚠️ [Worker ${workerId}] Model ${modelName} lỗi: ${err.message.substring(0, 100)}... Thử model tiếp theo.`);
        }
    }

    if (!response) {
        throw lastErr || new Error("Tất cả các model ứng viên đều thất bại");
    }

    let text = response.text;

    // Làm sạch chuỗi JSON từ Gemini
    if (text.includes('```json')) {
        text = text.split('```json')[1].split('```')[0].trim();
    } else if (text.includes('```')) {
        text = text.split('```')[1].split('```')[0].trim();
    }

    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("Kết quả trả về từ Gemini không phải là một mảng");
    return data;
}

// Hàng đợi các chủ đề cần xử lý
const topicQueue = Object.keys(topics);

async function worker(workerId) {
    console.log(`👷 [Worker ${workerId}] Bắt đầu khởi động luồng...`);
    while (topicQueue.length > 0) {
        const topic = topicQueue.shift(); // Lấy chủ đề tiếp theo
        if (!topic) break;

        console.log(`👷 [Worker ${workerId}] 🚀 Nhận nhiệm vụ chủ đề: "${topic}"`);
        let currentCount = await getExistingQuestionsCount(topic);
        console.log(`👷 [Worker ${workerId}] [${topic}] Trạng thái hiện tại: ${currentCount}/${TARGET_QUESTIONS_PER_TOPIC} câu.`);

        while (currentCount < TARGET_QUESTIONS_PER_TOPIC) {
            const needed = TARGET_QUESTIONS_PER_TOPIC - currentCount;
            const currentBatch = Math.min(BATCH_SIZE, needed); 

            try {
                const newQuestions = await generateQuestionsBatch(topic, currentCount, currentBatch, workerId);
                globalConsecutiveFailures = 0; // Reset counter on successful generation
                let added = 0;
                
                for (const item of newQuestions) {
                    if (!item.q || !Array.isArray(item.options) || item.options.length !== 4 || typeof item.a !== 'number') {
                        continue; // Bỏ qua câu hỏi lỗi định dạng
                    }

                    // Kiểm tra trùng lặp câu hỏi trong cơ sở dữ liệu
                    const check = await db.query('SELECT id FROM questions WHERE topic = $1 AND q = $2', [topic, item.q]);
                    if (check.rows.length === 0) {
                        await db.query(
                            'INSERT INTO questions (topic, q, options, a, difficulty) VALUES ($1, $2, $3, $4, $5)',
                            [topic, item.q, item.options, item.a, item.difficulty || 'bình thường']
                        );
                        added++;
                    }
                }

                currentCount = await getExistingQuestionsCount(topic);
                console.log(`👷 [Worker ${workerId}] -> [${topic}] Đã thêm ${added} câu. Đạt: ${currentCount}/${TARGET_QUESTIONS_PER_TOPIC}`);

                // Chờ delay 1.5s giữa các request của chính worker này để tránh rate limit của API Key tiếp theo
                await new Promise(resolve => setTimeout(resolve, 1500));
            } catch (err) {
                console.error(`⚠️  [Worker ${workerId}] [Lỗi] Không thể sinh câu hỏi cho chủ đề "${topic}":`, err.message);
                
                // Nếu bị lỗi Rate Limit (429) hoặc RESOURCE_EXHAUSTED, cho worker ngủ lâu hơn (30 giây) để các key và IP cooldown
                const isRateLimit = err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('quota');
                let delayMs = isRateLimit ? 30000 : 3000;
                
                if (isRateLimit) {
                    globalConsecutiveFailures++;
                    if (globalConsecutiveFailures >= apiKeys.length) {
                        console.log(`\n================================================================================`);
                        console.log(`⚠️  [CẢNH BÁO HỆ THỐNG] TẤT CẢ ${apiKeys.length} API KEYS ĐỀU ĐANG BỊ GOOGLE RATE LIMIT (429)!`);
                        console.log(`👉 Khả năng rất cao địa chỉ IP của bạn đã bị Google tạm khóa (limit: 0 cho free tier).`);
                        console.log(`💡 GIẢI PHÁP ĐỂ TIẾP TỤC NGAY LẬP TỨC:`);
                        console.log(`   1. Hãy đổi mạng kết nối (Ví dụ: phát 3G/4G/5G từ điện thoại di động sang máy tính).`);
                        console.log(`   2. Hoặc sử dụng VPN để đổi địa chỉ IP.`);
                        console.log(`   Sau khi bạn đổi IP thành công, tiến trình sẽ tự động chạy mượt mà trở lại!`);
                        console.log(`================================================================================\n`);
                        delayMs = 60000; // Tăng cooldown khi bị IP block để tránh spam Google
                    }
                }
                
                console.log(`👷 [Worker ${workerId}] Chuyển sang API Key tiếp theo và chờ ${delayMs / 1000} giây trước khi thử lại...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        console.log(`✔👷 [Worker ${workerId}] [${topic}] ĐÃ HOÀN THÀNH XONG 500/500 câu!`);
    }
    console.log(`👷 [Worker ${workerId}] 😴 Hết việc. Kết thúc luồng.`);
}

async function seedAllTopics() {
    try {
        console.log("⏳ Chờ 2 giây để chắc chắn các bảng database đã được khởi tạo xong...");
        await new Promise(resolve => setTimeout(resolve, 2000));

        await importJSONQuestions();
        console.log(`\n--- BẮT ĐẦU GỌI GEMINI AI ĐỂ SINH THÊM CÂU HỎI SONG SONG ---`);

        // Số lượng luồng chạy song song (giảm xuống 2 workers để giãn cách request, tránh rate limit và block IP)
        const CONCURRENCY = 2;
        console.log(`🚀 Khởi chạy đồng thời ${CONCURRENCY} luồng xử lý song song với ${apiKeys.length} API Keys!`);

        const workers = [];
        for (let i = 1; i <= CONCURRENCY; i++) {
            workers.push(worker(i));
        }

        // Chờ tất cả worker hoàn thành nhiệm vụ
        await Promise.all(workers);

        console.log(`\n🎉🎉🎉 HOÀN THÀNH THÀNH CÔNG: Đã lưu trữ và đồng bộ hóa thành công 5000 câu hỏi (10 chủ đề x 500 câu) lên Supabase!`);
    } catch (error) {
        console.error("❌ Lỗi nghiêm trọng trong quá trình seeding:", error);
    } finally {
        // Đóng kết nối database
        db.end(() => {
            console.log("🔌 Đã ngắt kết nối an toàn với cơ sở dữ liệu Supabase.");
            process.exit(0);
        });
    }
}

// Chạy tiến trình Seeding
seedAllTopics();
