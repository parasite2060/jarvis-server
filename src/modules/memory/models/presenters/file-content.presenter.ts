/**
 * Presenter for `GET /memory/soul`, `/memory/identity`, `/memory/memory`
 * (Story 13.4 / Q4 / Amendment 2).
 *
 * Snake_case `file_path` directly — NO `@Expose` overrides. Mirrors Python
 * `FileContentData` (memory.py:44-48). The plugin's `getMemoryDocument` reads
 * `envelope.data.content` only — `file_path` field is ignored.
 */
export class FileContentPresenter {
  content: string;
  file_path: string;

  constructor(content: string, filePath: string) {
    this.content = content;
    this.file_path = filePath;
  }
}
