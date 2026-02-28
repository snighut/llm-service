import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('file_uploads')
export class FileUpload {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  @Index()
  content_hash: string; // SHA256 hash for deduplication

  @Column({ type: 'varchar', length: 255 })
  original_filename: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  uploaded_by: string; // User ID

  @Column({ type: 'varchar', length: 255, unique: true })
  job_id: string; // BullMQ job ID

  @Column({ type: 'varchar', length: 500 })
  r2_object_key: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'processing',
  })
  status: 'processing' | 'completed' | 'failed';

  @Column({ type: 'integer', nullable: true })
  chunk_count: number;

  @Column({ type: 'text', nullable: true })
  error_message: string; // If failed

  @CreateDateColumn()
  uploaded_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
