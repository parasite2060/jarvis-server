import { Request, Response } from 'express';

export interface SerializedRequest {
  id?: string;
  method: string;
  url?: string;
  query?: unknown;
  params?: unknown;
  headers: unknown;
  remoteAddress?: string;
  remotePort?: number;
  body?: unknown;
}

export interface SerializedResponse {
  statusCode: number;
  headers: unknown;
}

export function serializeRequest(req: Request): SerializedRequest {
  const connection = req.socket;
  const requestWithId = req as Request & { id?: string };

  return {
    id: requestWithId.id,
    method: req.method,
    url: req.originalUrl || undefined,
    query: req.query,
    params: req.params,
    headers: req.headers,
    remoteAddress: connection?.remoteAddress,
    remotePort: connection?.remotePort,
    body: req.body,
  };
}

export function serializeResponse(res: Response): SerializedResponse {
  return {
    statusCode: res.statusCode,
    headers: res.getHeaders ? res.getHeaders() : (res as Response & { _headers?: unknown })._headers,
  };
}
