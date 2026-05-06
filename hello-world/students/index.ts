import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { enforceSchoolTenant } from '../middleware/tenant';
import { ok, created, noContent, errorResponse } from '../utils/response';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { withAccessLog } from '../middleware/accessLog';

const getLinkedStudents = async (parentId: string): Promise<string[]> => {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE, IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
    ExpressionAttributeValues: { ':pk': `PARENT#${parentId}`, ':sk': 'STUDENT#' },
  }));
  return (result.Items ?? []).map(i => i.studentId);
};

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const path = event.path;
    const studentId = event.pathParameters?.studentId;
    const classId = event.pathParameters?.classId;
    const schoolId = event.pathParameters?.schoolId ?? user.schoolId ?? '';
    const body = JSON.parse(event.body ?? '{}');

    enforceSchoolTenant(user, schoolId);

    // GET /classes/{classId}/students
    if (method === 'GET' && classId) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER']);
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: { ':pk': `CLASS#${classId}`, ':sk': 'STUDENT#' },
      }));
      return ok({ classId, students: result.Items ?? [] });
    }

    // GET /schools/{schoolId}/students/{studentId}
    if (method === 'GET' && studentId) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER', 'PARENT', 'STUDENT']);
      if (user.role === 'STUDENT' && user.studentId !== studentId)
        throw new ForbiddenError('Access denied');
      if (user.role === 'PARENT') {
        const linked = await getLinkedStudents(user.userId);
        if (!linked.includes(studentId)) throw new ForbiddenError('Access denied');
      }
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `STUDENT#${studentId}` },
      }));
      if (!result.Items?.length) throw new NotFoundError('Student not found');
      return ok(result.Items[0]);
    }

    // GET /schools/{schoolId}/students
    if (method === 'GET') {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER']);
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `SCHOOL#${schoolId}`, ':sk': 'STUDENT#' },
      }));
      return ok(result.Items ?? []);
    }

    // POST /schools/{schoolId}/students — schoolId always from JWT
    if (method === 'POST') {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER']);
      if (!body.classId || !body.firstName || !body.lastName)
        return errorResponse({ statusCode: 400, message: 'classId, firstName, lastName required' });
      const sid = randomUUID();
      const item = {
        PK: `SCHOOL#${schoolId}`, SK: `STUDENT#${sid}`,
        GSI1PK: `CLASS#${body.classId}`, GSI1SK: `STUDENT#${sid}`,
        GSI2PK: `STUDENT#${sid}`, GSI2SK: `STUDENT#${sid}`,
        entityType: 'STUDENT', studentId: sid,
        classId: body.classId, schoolId,
        lastName: body.lastName, firstName: body.firstName,
        phone: body.phone ?? null, email: body.email ?? null,
        createdAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
      return created(item);
    }

    // DELETE /schools/{schoolId}/students/{studentId}
    if (method === 'DELETE' && studentId) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR']);
      const find = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `STUDENT#${studentId}` },
      }));
      const student = find.Items?.[0];
      if (!student) throw new NotFoundError('Student not found');
      await docClient.send(new DeleteCommand({
        TableName: TABLE, Key: { PK: student.PK, SK: student.SK },
      }));
      return noContent();
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);
