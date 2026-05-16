require('dotenv').config({ path: 'server/.env' });
const { GoogleGenAI } = require('@google/genai');

async function testAI() {
    console.log("API KEY:", process.env.GEMINI_API_KEY ? "Found" : "NOT FOUND");
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("Say hello");
        console.log("AI Result:", result.response.text());
    } catch (err) {
        console.error("AI Error:", err);
    }
}

testAI();
