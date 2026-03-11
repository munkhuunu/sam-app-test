import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ClassService } from './classService';
import { authenticate, authorize } from '../middleware/auth';
import { ok, created, errorResponse } from '../utils/response';

const service = new ClassService();

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const schoolId = event.pathParameters?.schoolId;
    const body = JSON.parse(event.body ?? '{}');

    if (method === 'GET' && schoolId) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      return ok(await service.listBySchool(schoolId));
    }

    if (method === 'POST' && schoolId) {
      authorize(user, ['DIRECTOR', 'MANAGER']);
      return created(await service.createClass(schoolId, body));
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });

  } catch (err: any) {
    return errorResponse(err);
  }
};