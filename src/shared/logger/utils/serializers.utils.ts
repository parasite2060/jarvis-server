/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';

export function serializeRequest(req: Request): any {
  const connection = req.socket;
  const request: Record<string, any> = {};
  request['id'] = (req as any)['id'];
  request['method'] = req.method;

  if (req.originalUrl) {
    request['url'] = req.originalUrl;
  }

  if (req.query) {
    request['query'] = req.query;
  }

  if (req.params) {
    request['params'] = req.params;
  }

  request['headers'] = req.headers;
  request['remoteAddress'] = connection?.remoteAddress;
  request['remotePort'] = connection?.remotePort;

  if (req.body) {
    request['body'] = req.body;
  }

  return request;
}

export function serializeResponse(res: Response): any {
  const response: Record<string, any> = {};
  response['statusCode'] = res.statusCode;
  response['headers'] = res.getHeaders ? res.getHeaders() : (res as any)['_headers'];
  return response;
}
