import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';

export async function createMongoMemoryServer(): Promise<MongoMemoryServer> {
  return await MongoMemoryServer.create();
}

export function getMongooseTestModule(mongoServer: MongoMemoryServer) {
  return MongooseModule.forRoot(mongoServer.getUri());
}

export class MongoTestHelper {
  constructor(private readonly connection: Connection) {}

  async assertDocumentExists(collectionName: string, query: Record<string, any>, expected: Record<string, any>): Promise<any> {
    const collection = this.connection.db.collection(collectionName);
    const document = await collection.findOne(query);

    expect(document).toBeDefined();
    expect(document).toMatchObject(expected);
    return document;
  }

  async assertDocumentCount(collectionName: string, query: Record<string, any>, expectedCount: number): Promise<void> {
    const collection = this.connection.db.collection(collectionName);
    const count = await collection.countDocuments(query);
    expect(count).toBe(expectedCount);
  }

  async waitForDocument(collectionName: string, query: Record<string, any>, timeoutMs = 8000): Promise<any> {
    const collection = this.connection.db.collection(collectionName);
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const document = await collection.findOne(query);
      if (document) return document;
      await new Promise((r) => setTimeout(r, 100));
    }

    throw new Error(`Timeout waiting for document in ${collectionName} matching ${JSON.stringify(query)}`);
  }
}
