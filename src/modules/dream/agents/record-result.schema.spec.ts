import { FileActionSchema, RecordResultSchema } from './record-result.schema';

describe('record-result.schema', () => {
  describe('FileActionSchema', () => {
    it('accepts every canonical action', () => {
      for (const action of ['create', 'append', 'update', 'skip']) {
        expect(FileActionSchema.parse({ path: 'p', action })).toEqual({ path: 'p', action });
      }
    });

    it('rejects unknown actions', () => {
      expect(() => FileActionSchema.parse({ path: 'p', action: 'delete' })).toThrow();
    });
  });

  describe('RecordResultSchema', () => {
    it('parses a valid record result with files + summary', () => {
      const result = {
        files: [{ path: 'dailys/2026-05-08.md', action: 'create' as const }],
        summary: 'recorded session',
      };
      expect(RecordResultSchema.parse(result)).toEqual(result);
    });

    it('applies defaults when fields are missing', () => {
      const result = RecordResultSchema.parse({});
      expect(result.files).toEqual([]);
      expect(result.summary).toBe('');
    });
  });
});
