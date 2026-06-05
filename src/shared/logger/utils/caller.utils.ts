interface StackFrame {
  getFileName(): string | null;
  getLineNumber(): number | null;
}

export function getCallerFile(begin: number, includeKeywords: string[], preferKeyword: string, maxScan = 10): string | null {
  const frames = captureStackFrames();
  if (!frames) return null;

  let lastMatch: string | null = null;

  for (let i = begin; i < maxScan; i++) {
    const frame = frames[i];
    if (!frame) break;

    const fileName = frame.getFileName();
    if (!fileName) continue;

    const startIndex = firstKeywordIndex(fileName, includeKeywords);
    if (startIndex < 0) continue;

    const sourcePath = `${fileName.substring(startIndex)}:${frame.getLineNumber()}`;
    if (sourcePath.includes(preferKeyword)) return sourcePath;
    lastMatch = sourcePath;
  }

  return lastMatch;
}

function captureStackFrames(): StackFrame[] | null {
  const previous = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stack) => stack;
  const stack = new Error().stack as unknown as StackFrame[] | undefined;
  Error.prepareStackTrace = previous;
  return stack && typeof stack === 'object' ? stack : null;
}

function firstKeywordIndex(filePath: string, keywords: string[]): number {
  for (const keyword of keywords) {
    const index = filePath.indexOf(keyword);
    if (index >= 0) return index;
  }
  return -1;
}
