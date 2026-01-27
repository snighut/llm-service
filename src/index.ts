import express from 'express';
import cors from 'cors';
import logger from './utils/logger';
import routes from './routes';
import errorHandler from './middleware/errorHandler';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', routes);
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  logger.log(`llm-service running on port ${PORT}`);
});
