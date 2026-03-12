import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { QdrantClient, Schemas } from '@qdrant/js-client-rest';
import { Ollama, OllamaEmbeddings } from '@langchain/ollama';
import { StringOutputParser } from '@langchain/core/output_parsers';
import {
  RunnableSequence,
  RunnablePassthrough,
} from '@langchain/core/runnables';
import { PromptTemplate } from '@langchain/core/prompts';

type Document = Schemas['ScoredPoint'] & { payload: { page_content: string } };

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private readonly qdrantClient: QdrantClient;
  private readonly ollama: Ollama;
  private readonly embeddings: OllamaEmbeddings;
  private readonly collectionName = 'documents';
  private readonly minRequiredPoints = Number(
    process.env.RAG_MIN_REQUIRED_POINTS || '1',
  );

  constructor() {
    try {
      this.qdrantClient = new QdrantClient({
        url: process.env.QDRANT_URL,
      });
      this.ollama = new Ollama({
        baseUrl: process.env.OLLAMA_HOST,
        model: 'mistral-nemo:latest',
      });
      this.embeddings = new OllamaEmbeddings({
        model: 'mxbai-embed-large',
        baseUrl: process.env.OLLAMA_HOST,
      });
    } catch (err) {
      console.error('Error initializing RagService:', err);
      throw err;
    }
  }

  async onModuleInit(): Promise<void> {
    const readiness = await this.checkReadiness();
    if (readiness.ready) {
      this.logger.log(
        `RAG ready: collection '${this.collectionName}' has ${readiness.pointCount} points`,
      );
      return;
    }

    this.logger.error(
      `RAG not ready on startup: ${readiness.reason || 'unknown reason'}`,
    );
  }

  private async checkReadiness(): Promise<{
    ready: boolean;
    pointCount: number;
    reason?: string;
  }> {
    try {
      await this.qdrantClient.getCollection(this.collectionName);
    } catch {
      return {
        ready: false,
        pointCount: 0,
        reason: `Qdrant collection '${this.collectionName}' does not exist`,
      };
    }

    try {
      const countResult = await this.qdrantClient.count(this.collectionName, {
        exact: true,
      });

      if (countResult.count < this.minRequiredPoints) {
        return {
          ready: false,
          pointCount: countResult.count,
          reason: `Qdrant collection '${this.collectionName}' has ${countResult.count} points (minimum required: ${this.minRequiredPoints})`,
        };
      }

      return {
        ready: true,
        pointCount: countResult.count,
      };
    } catch {
      return {
        ready: false,
        pointCount: 0,
        reason: `Unable to read point count for Qdrant collection '${this.collectionName}'`,
      };
    }
  }

  async getReadinessStatus(): Promise<{
    ready: boolean;
    pointCount: number;
    reason?: string;
  }> {
    return this.checkReadiness();
  }

  private async ensureRagReady(): Promise<void> {
    const readiness = await this.checkReadiness();
    if (!readiness.ready) {
      throw new ServiceUnavailableException({
        error: 'RAG is unavailable',
        details: readiness.reason,
        collection: this.collectionName,
        pointCount: readiness.pointCount,
      });
    }
  }

  async getRelevantDocuments(query: string): Promise<Document[]> {
    await this.ensureRagReady();
    const queryEmbedding = await this.embeddings.embedQuery(query);
    const searchResult = await this.qdrantClient.search(this.collectionName, {
      vector: queryEmbedding,
      limit: 5,
    });
    return searchResult as Document[];
  }

  async getResponse(query: string) {
    const documents = await this.getRelevantDocuments(query);
    const serializedDocs = documents
      .map((doc) => doc.payload.page_content)
      .join('\n\n');

    const template = `Answer the question based only on the following context:
{context}

Question: {question}`;

    const prompt = PromptTemplate.fromTemplate(template);

    const chain = RunnableSequence.from([
      {
        context: () => serializedDocs,
        question: new RunnablePassthrough(),
      },
      prompt,
      this.ollama,
      new StringOutputParser(),
    ]);

    return chain.stream(query);
  }

  async getCompletion(query: string): Promise<string> {
    const documents = await this.getRelevantDocuments(query);
    const serializedDocs = documents
      .map((doc) => doc.payload.page_content)
      .join('\n\n');

    const template = `Answer the question based only on the following context:
{context}

Question: {question}`;

    const prompt = PromptTemplate.fromTemplate(template);

    const chain = RunnableSequence.from([
      {
        context: () => serializedDocs,
        question: new RunnablePassthrough(),
      },
      prompt,
      this.ollama,
      new StringOutputParser(),
    ]);

    return chain.invoke(query);
  }
}
