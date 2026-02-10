import { Injectable } from '@nestjs/common';
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
export class RagService {
  private readonly qdrantClient: QdrantClient;
  private readonly ollama: Ollama;
  private readonly embeddings: OllamaEmbeddings;

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

  async getRelevantDocuments(query: string): Promise<Document[]> {
    const queryEmbedding = await this.embeddings.embedQuery(query);
    const searchResult = await this.qdrantClient.search('documents', {
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
}
