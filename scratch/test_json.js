const fs = require('fs');
const path = require('path');

function removeAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function getQuestionsFromJSON(count = 5, topicQuery = null) {
    try {
        const topicsPath = 'd:/gema1/server/data/topics.json';
        console.log("Checking topics path:", topicsPath);
        if (!fs.existsSync(topicsPath)) {
            console.log("Topics path does not exist");
            return [];
        }
        const topics = JSON.parse(fs.readFileSync(topicsPath, 'utf8'));

        let fileName = null;
        
        if (topicQuery) {
            fileName = topics[topicQuery];
            if (!fileName) {
                const normalizedQuery = removeAccents(topicQuery.toLowerCase().trim());
                const key = Object.keys(topics).find(k => removeAccents(k.toLowerCase()) === normalizedQuery);
                if (key) fileName = topics[key];
            }
            if (!fileName) {
                const normalizedQuery = removeAccents(topicQuery.toLowerCase().trim());
                const key = Object.keys(topics).find(k => removeAccents(k.toLowerCase()).includes(normalizedQuery));
                if (key) fileName = topics[key];
            }
        } else {
            const keys = Object.keys(topics);
            console.log("Available topic keys:", keys);
            if (keys.length === 0) return [];
            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            fileName = topics[randomKey];
        }

        console.log("Selected file:", fileName);
        if (!fileName) return [];

        const filePath = 'd:/gema1/server/data/' + fileName;
        if (!fs.existsSync(filePath)) {
            console.log("File path does not exist:", filePath);
            return [];
        }
        const data = fs.readFileSync(filePath, 'utf8');
        const questions = JSON.parse(data);
        
        return questions.sort(() => 0.5 - Math.random()).slice(0, count);
    } catch (err) {
        console.error("Error reading questions from JSON:", err);
        return [];
    }
}

const q = getQuestionsFromJSON(5);
console.log("Questions found:", q.length);
if (q.length > 0) console.log("First question:", q[0].q);
