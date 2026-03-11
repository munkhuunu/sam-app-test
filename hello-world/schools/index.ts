import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SchoolService } from './schoolService';
import { ClassService } from '../classes/classService';
import { authenticate, authorize } from '../middleware/auth';
import { ok, created, errorResponse } from '../utils/response';

const schoolService = new SchoolService();
const classService = new ClassService();

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const path = event.path;
    const schoolId = event.pathParameters?.schoolId ?? event.pathParameters?.proxy;
    const body = JSON.parse(event.body ?? '{}');

    // /schools/{schoolId}/classes
    if (path.includes('/classes')) {
      const match = path.match(/\/schools\/([^\/]+)\/classes/);
      const sid = match?.[1];

      if (method === 'GET' && sid) {
        authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
        return ok(await classService.listBySchool(sid));
      }

      if (method === 'POST' && sid) {
        authorize(user, ['DIRECTOR', 'MANAGER']);
        return created(await classService.createClass(sid, body));
      }
    }

    // GET /schools
    if (method === 'GET' && !schoolId) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      return ok(await schoolService.listSchools());
    }

    // GET /schools/{schoolId}
    if (method === 'GET' && schoolId) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      return ok(await schoolService.getSchoolById(schoolId));
    }

    // POST /schools
    if (method === 'POST' && !schoolId) {
      authorize(user, ['DIRECTOR']);
      return created(await schoolService.createSchool(body));
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });

  } catch (err: any) {
    return errorResponse(err);
  }
};