/* eslint-disable @typescript-eslint/no-explicit-any */
export function getCallerFile(begin: number, startKeywords: string[], selectKeywork: string, maxScan = 10): string | null {
  const oldPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = function (_, stack) {
    return stack;
  };
  const stack = new Error().stack;
  Error.prepareStackTrace = oldPrepareStackTrace;

  let lastFilePath = null;
  if (stack && typeof stack === 'object') {
    for (let i = begin; i < maxScan; i++) {
      const stackItem = (stack as any)[i];
      if (!stackItem) {
        break;
      }

      const fileName = stackItem.getFileName() as string;
      if (fileName) {
        const startIndex = getStartIndex(fileName, startKeywords);
        if (startIndex >= 0) {
          const sourceFilePath = `${fileName.substring(startIndex)}:${stackItem.getLineNumber()}`;
          if (sourceFilePath.indexOf(selectKeywork) >= 0) {
            return sourceFilePath;
          } else {
            lastFilePath = sourceFilePath;
          }
        }
      }
    }
  }

  return lastFilePath;
}

function getStartIndex(filePath: string, keyworks: string[]): number {
  for (const keywork of keyworks) {
    const index = filePath.indexOf(keywork);
    if (index >= 0) {
      return index;
    }
  }

  return -1;
}
