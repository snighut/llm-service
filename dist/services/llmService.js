"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryLLM = void 0;
const axios_1 = __importDefault(require("axios"));
const queryLLM = async (prompt) => {
    const url = process.env.LLM_NODE_URL || 'http://ubuntu-llm-node:8000/completion';
    const response = await axios_1.default.post(url, { prompt });
    return response.data;
};
exports.queryLLM = queryLLM;
