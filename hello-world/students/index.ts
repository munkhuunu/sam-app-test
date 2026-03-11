import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { StudentService } from './studentService';
import { authenticate, authorize } from '../middleware/auth';
import { ok, created, noContent, errorResponse } from '../utils/response';

const service = new StudentService();

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const user = authenticate(event);
    const method = event.httpMethod;
    const studentId = event.pathParameters?.studentId;
    const classId = event.pathParameters?.classId;
    const body = JSON.parse(event.body ?? '{}');

    if (method === 'GET' && classId) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      const result = await service.getStudentsByClass(
        user.role === 'TEACHER' ? user.classId! : classId
      );
      return ok(result);
    }

    if (method === 'GET' && studentId) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER', 'PARENT', 'STUDENT']);
      const student = await service.getStudentById(
        studentId, user.studentId, user.role
      );
      return ok(student);
    }

    if (method === 'POST') {
      authorize(user, ['DIRECTOR', 'MANAGER']);
      return created(await service.createStudent(body));
    }

    if (method === 'PUT' && studentId) {
      authorize(user, ['DIRECTOR', 'MANAGER']);
      return ok(await service.updateStudent(studentId, body));
    }

    if (method === 'DELETE' && studentId) {
      authorize(user, ['DIRECTOR']);
      await service.deleteStudent(studentId);
      return noContent();
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });

  } catch (err: any) {
    return errorResponse(err);
  }
};