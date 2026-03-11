import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AuthService } from './authService';
import { ok, created, errorResponse } from '../utils/response';

const service = new AuthService();

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const path = event.path;
    const body = JSON.parse(event.body ?? '{}');

    if (method === 'POST' && path.endsWith('/register')) {
      const result = await service.register(body);
      return created(result);
    }

    if (method === 'POST' && path.endsWith('/login')) {
      const result = await service.login(body);
      return ok(result);
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });

  } catch (err: any) {
    return errorResponse(err);
  }
};