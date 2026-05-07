/**
 * Conversation entity (Story 13.2 / Task 3).
 *
 * POTO mirror of `jarvis.transcripts` (Python `Transcript` in
 * `components/jarvis-server/app/models/tables.py`). Class is named `Conversation`
 * per module-map §3.1 (the Python table name is `transcripts`; the TS domain name
 * is `Conversation` to match Story 13.3's `conversation` module).
 */
export class Conversation {
  id!: number;
  sessionId!: string;
  project?: string | null;
  rawContent!: string;
  parsedText?: string | null;
  tokenCount?: number | null;
  source?: string | null;
  status: string = 'received';
  lightDreamId?: number | null;
  isContinuation: boolean = false;
  segmentStartLine: number = 0;
  segmentEndLine: number = 0;
  lastProcessedLine: number = 0;
  createdAt!: Date;
  updatedAt!: Date;

  constructor(init?: Partial<Conversation>) {
    Object.assign(this, init);
  }
}
