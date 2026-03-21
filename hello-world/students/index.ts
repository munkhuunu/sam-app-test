import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { validateCreateStudent } from '../validators';
import { ok, created, noContent, errorResponse } from '../utils/response';
import { NotFoundError } from '../utils/errors';

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const path = event.path;
    const studentId = event.pathParameters?.studentId;
    const classId = event.pathParameters?.classId;
    const body = JSON.parse(event.body ?? '{}');

    if (method === 'GET' && classId) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: { ':pk': `CLASS#${classId}`, ':sk': 'STUDENT#' },
      }));
      return ok({ classId, students: result.Items ?? [] });
    }

    if (method === 'GET' && studentId && path.endsWith('/grades')) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER', 'PARENT', 'STUDENT']);
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: { ':pk': `STUDENT#${studentId}#GRADES`, ':sk': 'GRADE#' },
      }));
      return ok(result.Items ?? []);
    }

    if (method === 'GET' && studentId) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER', 'PARENT', 'STUDENT']);
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `STUDENT#${studentId}` },
      }));
      if (!result.Items?.length) throw new NotFoundError('Student not found');
      return ok(result.Items[0]);
    }

    if (method === 'POST') {
      authorize(user, ['DIRECTOR', 'MANAGER']);
      validateCreateStudent(body);

      const id = randomUUID();
      const item = {
        PK: `SCHOOL#${body.schoolId}`,
        SK: `STUDENT#${id}`,
        GSI1PK: `CLASS#${body.classId}`,
        GSI1SK: `STUDENT#${id}`,
        GSI2PK: `STUDENT#${id}`,
        GSI2SK: `STUDENT#${id}`,
        entityType: 'STUDENT',
        studentId: id,
        classId: body.classId,
        schoolId: body.schoolId,
        lastName: body.lastName,
        firstName: body.firstName,
        phone: body.phone ?? null,
        email: body.email ?? null,
        createdAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
      return created(item);
    }

    if (method === 'DELETE' && studentId) {
      authorize(user, ['DIRECTOR']);
      const find = await docClient.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI2',
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
