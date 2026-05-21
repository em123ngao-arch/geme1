const { GoogleGenAI } = require('@google/genai');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);

async function testKey(key, model) {
    try {
        const ai = new GoogleGenAI({ apiKey: key });
        const result = await ai.models.generateContent({
            model: model,
            contents: "Say 'Hello OK'",
        });
        return { success: true, text: result.text.trim() };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function run() {
    console.log(`🔑 Testing ${apiKeys.length} keys...`);
    const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
    
    for (let i = 0; i < apiKeys.length; i++) {
        const key = apiKeys[i];
        const abbr = key.substring(0, 8) + '...';
        console.log(`\n--- Key #${i + 1} (${abbr}) ---`);
        for (const model of models) {
            const res = await testKey(key, model);
            if (res.success) {
                console.log(`✅ [${model}]: Success! Response: "${res.text}"`);
            } else {
                console.log(`❌ [${model}]: Failed! Error: ${res.error.substring(0, 150)}`);
            }
        }
    }
}

run();
