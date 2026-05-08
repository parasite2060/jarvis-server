/**
 * File-serve envelope presenter — Story 13.6 / Q1 + Q7 bindings.
 *
 * Plugin reads `data.content` (verified at `worker/file-sync.js:90`).
 * camelCase wire format throughout — `filePath` NOT `file_path`.
 */
export class FileServePresenter {
  public readonly content: string;
  public readonly filePath: string;
  public readonly hash: string;
  public readonly size: number;

  constructor(init: { content: string; filePath: string; hash: string; size: number }) {
    this.content = init.content;
    this.filePath = init.filePath;
    this.hash = init.hash;
    this.size = init.size;
  }
}
