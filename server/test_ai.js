require('dotenv').config({ path: 'server/.env' });
const { GoogleGenAI } = require('@google/genai');

async function testAI() {
    console.log("API KEY:", process.env.GEMINI_API_KEY ? "Found" : "NOT FOUND");
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: "Say hello",
        });
        console.log("AI Result:", result.text);
    } catch (err) {
        console.error("AI Error:", err);
    }
}

testAI();
