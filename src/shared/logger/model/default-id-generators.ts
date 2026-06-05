import { Request, Response } from 'express';
import { randomId } from '../internal/random-id';
import { CLOUD_TRACE_HEADERS } from './cloud-trace-headers';

export function defaultHttpIdGenerator(req: Request, _res: Response): string {
  for (const header of CLOUD_TRACE_HEADERS) {
    const requestId = req.headers[header];
    if (requestId) return requestId.toString();
  }

  return randomId();
}
