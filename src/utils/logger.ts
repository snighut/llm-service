const logger = {
  log: (...args: any[]) => console.log('[LOG]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
};
export default logger;
