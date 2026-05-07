import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config({ path: '.env.e2e', quiet: true });

process.env['NODE_ENV'] = 'test';
process.env['RUNTIME_ENV'] = 'test';

jest.setTimeout(30000);

// Delete previous e2e-test.log file if exists
const logFilePath = path.join(process.cwd(), 'logs', 'e2e-test.log');
if (fs.existsSync(logFilePath)) {
  try {
    fs.unlinkSync(logFilePath);
  } catch {
    // Ignore errors
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
