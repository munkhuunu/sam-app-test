import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { enforceSchoolTenant } from '../middleware/tenant';
import { validateCreateTeacher, validateTeacherSubjectAssignment } from '../validators';
import { ok, created, errorResponse } from '../utils/response';
import { NotFoundError } from '../utils/errors';
import { withAccessLog } from '../middleware/accessLog';

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const path = event.path;
    const body = JSON.parse(event.body ?? '{}');
    const schoolId = event.pathParameters?.schoolId ?? user.schoolId ?? '';

    enforceSchoolTenant(user, schoolId);

    // GET /schools/{schoolId}/teachers
    if (method === 'GET' && !path.endsWith('/assign')) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER']);
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: { ':pk': `SCHOOL#${schoolId}#TEACHERS`, ':sk': 'TEACHER#' },
      }));
      return ok(result.Items ?? []);
    }

    // POST /schools/{schoolId}/teachers
    if (method === 'POST' && !path.endsWith('/assign')) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER']);
      validateCreateTeacher(body);
      const teacherId = randomUUID();
      const item = {
        PK: `SCHOOL#${schoolId}`, SK: `TEACHER#${teacherId}`,
        GSI1PK: `SCHOOL#${schoolId}#TEACHERS`, GSI1SK: `TEACHER#${teacherId}`,
        GSI2PK: `TEACHER#${teacherId}`, GSI2SK: `TEACHER#${teacherId}`,
        entityType: 'TEACHER', teacherId, schoolId,
        firstName: body.firstName, lastName: body.lastName,
        email: body.email ?? null, phone: body.phone ?? null,
        assignments: [],
        createdAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
      return created(item);
    }

    // POST /schools/{schoolId}/teachers/assign — Teacher-Class-Subject assignment
    if (method === 'POST' && path.endsWith('/assign')) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER']);
      validateTeacherSubjectAssignment(body);
      const teacherResult = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `TEACHER#${body.teacherId}` },
      }));
      const teacher = teacherResult.Items?.[0];
      if (!teacher) throw new NotFoundError('Teacher not found');
      const assignments: any[] = teacher.assignments ?? [];
      const alreadyAssigned = assignments.find(
        (a: any) => a.classId === body.classId && a.subjectId === body.subjectId
      );
      if (!alreadyAssigned) assignments.push({ classId: body.classId, subjectId: body.subjectId });
      await docClient.send(new UpdateCommand({
        TableName: TABLE, Key: { PK: teacher.PK, SK: teacher.SK },
        UpdateExpression: 'SET assignments = :a, updatedAt = :now',
        ExpressionAttributeValues: { ':a': assignments, ':now': new Date().toISOString() },
      }));
      // Lookup record for class schedule queries
      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `SCHOOL#${schoolId}`, SK: `TASSIGN#${body.teacherId}#${body.classId}#${body.subjectId}`,
          GSI1PK: `CLASS#${body.classId}`, GSI1SK: `TEACHER#${body.teacherId}#SUBJ#${body.subjectId}`,
          GSI2PK: `TEACHER#${body.teacherId}`, GSI2SK: `CLASS#${body.classId}#SUBJ#${body.subjectId}`,
          entityType: 'TEACHER_ASSIGNMENT',
          schoolId, teacherId: body.teacherId, classId: body.classId, subjectId: body.subjectId,
          createdAt: new Date().toISOString(),
        },
      }));
      return ok({ message: 'Teacher assigned', teacherId: body.teacherId, classId: body.classId, subjectId: body.subjectId });
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);
