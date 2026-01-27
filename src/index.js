
const express = require('express');
const cors = require('cors');
const logger = require('./utils/logger');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();
app.use(cors());
app.use(express.json());

// Mount all routes under /api
app.use('/api', routes);

// Error handler (should be last)
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  logger.log(`llm-service running on port ${PORT}`);
});
