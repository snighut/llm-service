import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { OllamaEmbeddings } from '@langchain/ollama';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { StorageService } from '../storage/storage.service';
import { IngestionService } from './ingestion.service';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface PdfJobData {
  objectKey: string;
  fileHash: string;
  fileName: string;
}

interface DocChunk {
  pageContent: string;
  metadata: Record<string, any>;
}

@Processor('pdf-ingestion', {
  stalledInterval: 300000, // 5 minutes before considering stalled
  maxStalledCount: 2, // Max times to retry stalled jobs
})
@Injectable()
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);
  private readonly qdrantClient: QdrantClient;
  private readonly embeddings: OllamaEmbeddings;

  constructor(
    private readonly storageService: StorageService,
    private readonly ingestionService: IngestionService,
  ) {
    super();
    this.qdrantClient = new QdrantClient({
      url: process.env.QDRANT_URL || 'http://localhost:6333',
    });
    this.embeddings = new OllamaEmbeddings({
      model: 'mxbai-embed-large',
      baseUrl: process.env.OLLAMA_HOST || 'http://localhost:11434',
    });

    this.logger.log('Ingestion processor initialized');
  }

  async process(job: Job<PdfJobData>): Promise<{
    status: string;
    totalChunks: number;
    processedChunks: number;
    fileHash: string;
  }> {
    const { objectKey, fileHash, fileName } = job.data;
    this.logger.log(`Processing job ${job.id}: ${fileName}`);
    this.logger.log(`File hash: ${fileHash}, Object key: ${objectKey}`);

    let tempPath: string | null = null;

    try {
      // 1. Download from R2
      await job.updateProgress(10);
      this.logger.log(`Downloading from R2: ${objectKey}`);
      const pdfBuffer = await this.storageService.downloadFile(objectKey);
      this.logger.log(`Downloaded ${pdfBuffer.length} bytes`);

      // 2. Save to temp file (PDFLoader needs file path)
      tempPath = path.join(os.tmpdir(), `${uuidv4()}.pdf`);
      await fs.writeFile(tempPath, pdfBuffer);
      this.logger.log(`Saved to temp file: ${tempPath}`);

      // 3. Load and chunk PDF
      await job.updateProgress(30);
      this.logger.log(`Loading PDF: ${fileName}`);
      const loader = new PDFLoader(tempPath);
      const docs: DocChunk[] = (await loader.load()) as DocChunk[];
      this.logger.log(`Loaded ${docs.length} pages from PDF`);

      this.logger.log(`Chunking PDF: ${docs.length} pages`);
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 600,
        chunkOverlap: 100,
      });
      const chunks: DocChunk[] = (await splitter.splitDocuments(
        docs,
      )) as DocChunk[];
      this.logger.log(`Created ${chunks.length} initial chunks`);

      // Clean up temp file
      await fs.unlink(tempPath);
      tempPath = null;
      this.logger.log('Temp file cleaned up');

      // Validate and further split oversized chunks
      // mxbai-embed-large has 512 token limit (~2048 chars), so stay well under
      this.logger.log('Validating and splitting oversized chunks...');
      const validChunks: DocChunk[] = [];
      let oversizedCount = 0;
      for (const chunk of chunks) {
        const content = chunk.pageContent.trim();
        if (content.length < 10) continue;

        if (content.length > 1500) {
          // Split oversized chunks further
          oversizedCount++;
          this.logger.log(
            `Splitting oversized chunk ${oversizedCount}: ${content.length} chars`,
          );
          const subChunks = await this.splitOversizedChunk(
            {
              pageContent: content,
              metadata: chunk.metadata,
            },
            1500,
          );
          validChunks.push(...subChunks);
        } else {
          validChunks.push({
            pageContent: content,
            metadata: chunk.metadata,
          });
        }
      }

      this.logger.log(
        `Processed ${chunks.length} chunks, found ${oversizedCount} oversized`,
      );

      if (validChunks.length === 0) {
        throw new Error('No valid chunks found in PDF');
      }

      this.logger.log(`Valid chunks: ${validChunks.length} / ${chunks.length}`);

      // 4. Batch embed with fallback (Strategy 3)
      await job.updateProgress(50);
      let embeddings: (number[] | null)[];

      try {
        // Try batch embedding first
        this.logger.log('Attempting batch embedding...');
        embeddings = await this.embeddings.embedDocuments(
          validChunks.map((c: DocChunk) => c.pageContent),
        );
        this.logger.log('Batch embedding successful');
      } catch (batchError) {
        this.logger.warn(
          'Batch embedding failed, trying individually',
          batchError,
        );
        embeddings = await this.embedChunksIndividually(validChunks, job);
      }

      // 5. Store in Qdrant
      await job.updateProgress(80);
      this.logger.log('Storing chunks in Qdrant...');

      const validPoints = validChunks
        .map((chunk: DocChunk, i: number) => {
          if (!embeddings[i]) {
            return null;
          }
          return {
            id: uuidv4(),
            vector: embeddings[i],
            payload: {
              page_content: chunk.pageContent,
              content_hash: fileHash,
              source_file: fileName,
              chunk_index: i,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              page_number: (chunk.metadata?.loc?.pageNumber as number) ?? 0,
              r2_object_key: objectKey,
              ingested_at: new Date().toISOString(),
            },
          };
        })
        .filter((p) => p !== null);

      await this.qdrantClient.upsert('documents', {
        points: validPoints,
      });

      this.logger.log(`Stored ${validPoints.length} chunks in Qdrant`);

      // 6. Update database metadata
      await this.ingestionService.updateStatus(
        fileHash,
        'completed',
        validPoints.length,
      );

      // 7. Delete from R2 (cleanup)
      await job.updateProgress(95);
      await this.storageService.deleteFile(objectKey);

      await job.updateProgress(100);

      this.logger.log(
        `Job ${job.id} completed: ${validPoints.length} chunks stored`,
      );

      return {
        status: 'success',
        totalChunks: chunks.length,
        processedChunks: validPoints.length,
        fileHash,
      };
    } catch (error) {
      this.logger.error(`Job ${job.id} failed:`, error);

      // Clean up temp file if it exists
      if (tempPath) {
        try {
          await fs.unlink(tempPath);
        } catch (unlinkError) {
          this.logger.warn('Failed to clean up temp file', unlinkError);
        }
      }

      // Update database with failure
      await this.ingestionService.updateStatus(
        fileHash,
        'failed',
        0,
        (error as Error).message,
      );

      throw error;
    }
  }

  /**
   * Split oversized chunks that exceed the embedding model's context window
   */
  private async splitOversizedChunk(
    chunk: DocChunk,
    maxSize: number,
  ): Promise<DocChunk[]> {
    try {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: maxSize,
        chunkOverlap: 50,
      });
      const subDocs = await splitter.splitDocuments([chunk]);
      this.logger.log(`Split into ${subDocs.length} sub-chunks`);
      return subDocs as DocChunk[];
    } catch (error) {
      this.logger.error('Error splitting oversized chunk:', error);
      // Fallback: return original chunk if splitting fails
      return [chunk];
    }
  }

  /**
   * Embed chunks individually (fallback for batch failure)
   */
  private async embedChunksIndividually(
    chunks: DocChunk[],
    job: Job<PdfJobData>,
  ): Promise<(number[] | null)[]> {
    const embeddings: (number[] | null)[] = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const emb = await this.embeddings.embedQuery(chunks[i].pageContent);
        embeddings.push(emb);

        // Update progress to prevent stalling (50% -> 80% range)
        const progress = 50 + Math.floor((i / chunks.length) * 30);
        await job.updateProgress(progress);

        if ((i + 1) % 5 === 0 || i === 0) {
          this.logger.log(
            `Embedded ${i + 1}/${chunks.length} chunks (${progress}%)`,
          );
        }
      } catch (err) {
        this.logger.error(`Chunk ${i + 1} embedding failed:`, err);
        this.logger.error(
          `Chunk length: ${chunks[i].pageContent.length} characters`,
        );
        embeddings.push(null);
      }
    }
    return embeddings;
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<PdfJobData>) {
    this.logger.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PdfJobData>, error: Error) {
    this.logger.error(`Job ${job.id} failed:`, error);
  }

  @OnWorkerEvent('active')
  onActive(job: Job<PdfJobData>) {
    this.logger.log(`Job ${job.id} is now active`);
  }
}
