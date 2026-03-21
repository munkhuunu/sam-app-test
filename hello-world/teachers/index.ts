import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { validateCreateTeacher, validateAssignTeacher } from '../validators';
import { ok, created, errorResponse } from '../utils/response';

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const path = event.path;
    const body = JSON.parse(event.body ?? '{}');

    if (method === 'GET' && path === '/teachers') {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      const schoolId = event.queryStringParameters?.schoolId;
      if (!schoolId) return errorResponse({ statusCode: 400, message: 'schoolId query param required' });

      const result = await docClient.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: { ':pk': `SCHOOL#${schoolId}#TEACHERS`, ':sk': 'TEACHER#' },
      }));
      return ok(result.Items ?? []);
    }

    if (method === 'POST' && path === '/teachers') {
      authorize(user, ['DIRECTOR', 'MANAGER']);
      validateCreateTeacher(body);

      const teacherId = randomUUID();
      const item = {
        PK: `SCHOOL#${body.schoolId}`,
        SK: `TEACHER#${teacherId}`,
        GSI1PK: `SCHOOL#${body.schoolId}#TEACHERS`,
        GSI1SK: `TEACHER#${teacherId}`,
        GSI2PK: `TEACHER#${teacherId}`,
        GSI2SK: `TEACHER#${teacherId}`,
        entityType: 'TEACHER',
        teacherId,
        schoolId: body.schoolId,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email ?? null,
        phone: body.phone ?? null,
        classIds: [],
        subjectIds: [],
        createdAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
      return created(item);
    }

    if (method === 'POST' && path.endsWith('/assign')) {
      authorize(user, ['DIRECTOR', 'MANAGER']);
      validateAssignTeacher(body);

      const teacherResult = await docClient.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `TEACHER#${body.teacherId}` },
      }));
      const teacher = teacherResult.Items?.[0];
      if (!teacher) return errorResponse({ statusCode: 404, message: 'Teacher not found' });

      const classIds = new Set(teacher.classIds ?? []);
      classIds.add(body.classId);

      await docClient.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: teacher.PK, SK: teacher.SK },
        UpdateExpression: 'SET classIds = :cids, updatedAt = :now',
        ExpressionAttributeValues: {
          ':cids': Array.from(classIds),
          ':now': new Date().toISOString(),
        },
      }));

      return ok({ message: 'Teacher assigned', teacherId: body.teacherId, classId: body.classId });
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};
