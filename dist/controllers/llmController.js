"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.completion = exports.streamTokens = exports.validatePrompt = void 0;
const llmService_1 = require("../services/llmService");
const axios_1 = __importDefault(require("axios"));
const validatePrompt = (req, res) => {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.length > 2048) {
        return res.status(400).json({ valid: false, reason: 'Invalid or too long prompt' });
    }
    res.json({ valid: true });
};
exports.validatePrompt = validatePrompt;
const streamTokens = async (req, res) => {
    const { prompt } = req.body;
    if (!prompt)
        return res.status(400).json({ error: 'Prompt required' });
    try {
        const response = await (0, axios_1.default)({
            method: 'post',
            url: process.env.LLM_NODE_URL || 'http://ubuntu-llm-node:8000/stream',
            data: { prompt },
            responseType: 'stream',
            timeout: 60000
        });
        res.setHeader('Content-Type', 'text/event-stream');
        response.data.pipe(res);
    }
    catch (err) {
        res.status(500).json({ error: 'LLM node error', details: err.message });
    }
};
exports.streamTokens = streamTokens;
const completion = async (req, res) => {
    const { prompt } = req.body;
    if (!prompt)
        return res.status(400).json({ error: 'Prompt required' });
    try {
        const result = await (0, llmService_1.queryLLM)(prompt);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: 'LLM node error', details: err.message });
    }
};
exports.completion = completion;
