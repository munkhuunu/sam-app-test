import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SchoolService } from './schoolService';
import { authenticate, authorize } from '../middleware/auth';
import { ok, created, errorResponse } from '../utils/response';

const service = new SchoolService();

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const user = authenticate(event);
    const method = event.httpMethod;
    const schoolId = event.pathParameters?.schoolId;
    const body = JSON.parse(event.body ?? '{}');

    if (method === 'GET' && !schoolId) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      return ok(await service.listSchools());
    }

    if (method === 'GET' && schoolId) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      return ok(await service.getSchoolById(schoolId));
    }

    if (method === 'POST') {
      authorize(user, ['DIRECTOR']);
      return created(await service.createSchool(body));
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });

  } catch (err: any) {
    return errorResponse(err);
  }
};