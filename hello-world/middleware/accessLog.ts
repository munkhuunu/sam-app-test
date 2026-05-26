/**
 * middleware/accessLog.ts
 *
 * Usage — wrap any Lambda handler:
 *   export const lambdaHandler = withAccessLog(handler);
 *
 * Logged fields (queryable in CloudWatch Logs Insights):
 *   requestId, userId, method, path, statusCode, durationMs,
 *   bodySize, sourceIp, userAgent, queryParams, pathParams, error
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '../libs/logger';

type Handler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

export function withAccessLog(handler: Handler): Handler {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const start     = Date.now();
    const requestId = event.requestContext?.requestId ?? 'local';
    const method    = event.httpMethod;
    const path      = event.path;
    const sourceIp  = event.requestContext?.identity?.sourceIp ?? null;
    const userAgent = event.headers?.['User-Agent'] ?? event.headers?.['user-agent'] ?? null;
    const log       = new Logger({ requestId, method, path });

    let result: APIGatewayProxyResult;
    let errorMessage: string | undefined;

    try {
      result = await handler(event);
    } catch (err: any) {
      errorMessage = err?.message ?? 'Unhandled exception';
      result = {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Internal server error' }),
      };
    }

    const durationMs = Date.now() - start;
    const statusCode = result.statusCode;
    const bodySize   = Buffer.byteLength(result.body ?? '', 'utf8');

    if (!errorMessage && statusCode >= 400) {
      try { errorMessage = JSON.parse(result.body)?.message; } catch { errorMessage = result.body; }
    }

    const entry: Record<string, unknown> = {
      requestId, method, path, statusCode, durationMs, bodySize,
      sourceIp, userAgent,
      queryParams: event.queryStringParameters ?? null,
      pathParams:  event.pathParameters ?? null,
    };
    if (errorMessage) entry.error = errorMessage;

    if      (statusCode >= 500) log.error('ACCESS_LOG', entry);
    else if (statusCode >= 400) log.warn ('ACCESS_LOG', entry);
    else                        log.info ('ACCESS_LOG', entry);

    return result;
  };
}
