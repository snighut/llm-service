"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger = {
    log: (...args) => console.log('[LOG]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
};
exports.default = logger;
