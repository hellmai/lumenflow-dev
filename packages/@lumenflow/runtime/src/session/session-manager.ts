import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface SessionManagerOptions {
  checkpointsDir: string;
}

export interface SessionRecord {
  session_id: string;
  agent_id: string;
  created_at: string;
  updated_at: string;
  state?: Record<string, unknown>;
}

export interface CreateSessionInput {
  agent_id: string;
}

export class SessionManager {
  private readonly checkpointsDir: string;
  private readonly sessionsById: Map<string, SessionRecord>;

  constructor(options: SessionManagerOptions) {
    this.checkpointsDir = path.resolve(options.checkpointsDir);
    this.sessionsById = new Map<string, SessionRecord>();
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    await mkdir(this.checkpointsDir, { recursive: true });
    const now = new Date().toISOString();
    const session: SessionRecord = {
      session_id: randomUUID(),
      agent_id: input.agent_id,
      created_at: now,
      updated_at: now,
    };
    this.sessionsById.set(session.session_id, session);
    await this.persist(session);
    return session;
  }

  async checkpoint(sessionId: string, state: Record<string, unknown>): Promise<SessionRecord> {
    const existing = await this.restore(sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const updated: SessionRecord = {
      ...existing,
      updated_at: new Date().toISOString(),
      state,
    };
    this.sessionsById.set(sessionId, updated);
    await this.persist(updated);
    return updated;
  }

  async restore(sessionId: string): Promise<SessionRecord | null> {
    const inMemory = this.sessionsById.get(sessionId);
    if (inMemory) {
      return inMemory;
    }

    try {
      const data = await readFile(this.filePath(sessionId), 'utf8');
      const parsed = JSON.parse(data) as SessionRecord;
      this.sessionsById.set(sessionId, parsed);
      return parsed;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    this.sessionsById.delete(sessionId);
  }

  private async persist(session: SessionRecord): Promise<void> {
    await mkdir(this.checkpointsDir, { recursive: true });
    await writeFile(this.filePath(session.session_id), JSON.stringify(session), 'utf8');
  }

  private filePath(sessionId: string): string {
    return path.join(this.checkpointsDir, `${sessionId}.json`);
  }
}
