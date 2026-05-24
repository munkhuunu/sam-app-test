import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, BatchWriteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { enforceSchoolTenant } from '../middleware/tenant';
import { validateMarkAttendance } from '../validators';
import { ok, created, errorResponse } from '../utils/response';
import { ForbiddenError } from '../utils/errors';
import { withAccessLog } from '../middleware/accessLog';

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const path = event.path;
    const body = JSON.parse(event.body ?? '{}');

    if (method === 'GET' && path === '/attendance') {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      const classId = event.queryStringParameters?.classId;
      const date = event.queryStringParameters?.date;
      if (!classId) return errorResponse({ statusCode: 400, message: 'classId required' });

      // Tenant check: class нь хэрэглэгчийн сургуулийнх мөн эсэхийг шалгана
      if (user.role !== 'SUPER_ADMIN') {
        const classItem = await docClient.send(new GetCommand({
          TableName: TABLE,
          Key: { PK: `SCHOOL#${user.schoolId}`, SK: `CLASS#${classId}` },
        }));
        if (!classItem.Item) throw new ForbiddenError('Class not found in your school');
      }

      let keyExpr = 'GSI1PK = :pk';
      const exprValues: Record<string, any> = { ':pk': `CLASS#${classId}#ATTENDANCE` };
      if (date) {
        keyExpr += ' AND begins_with(GSI1SK, :date)';
        exprValues[':date'] = `DATE#${date}`;
      }
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: keyExpr,
        ExpressionAttributeValues: exprValues,
      }));
      return ok(result.Items ?? []);
    }

    const studentMatch = path.match(/\/attendance\/([^\/]+)/);
    if (method === 'GET' && studentMatch && studentMatch[1] !== 'undefined') {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER', 'PARENT', 'STUDENT']);
      const studentId = studentMatch[1];
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `STUDENT#${studentId}#ATTENDANCE` },
      }));
      return ok(result.Items ?? []);
    }

    if (method === 'POST' && path === '/attendance') {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      validateMarkAttendance(body);

      // Tenant check: class нь хэрэглэгчийн сургуулийнх мөн эсэхийг шалгана
      if (user.role !== 'SUPER_ADMIN') {
        const classItem = await docClient.send(new GetCommand({
          TableName: TABLE,
          Key: { PK: `SCHOOL#${user.schoolId}`, SK: `CLASS#${body.classId}` },
        }));
        if (!classItem.Item) throw new ForbiddenError('Class not found in your school');
      }

      const items = body.records.map((r: any) => ({
        PK: `CLASS#${body.classId}`,
        SK: `ATTENDANCE#${body.date}#${r.studentId}`,
        GSI1PK: `CLASS#${body.classId}#ATTENDANCE`,
        GSI1SK: `DATE#${body.date}#STUDENT#${r.studentId}`,
        GSI2PK: `STUDENT#${r.studentId}#ATTENDANCE`,
        GSI2SK: `DATE#${body.date}`,
        entityType: 'ATTENDANCE',
        classId: body.classId, studentId: r.studentId,
        date: body.date, status: r.status,
        note: r.note ?? null, markedBy: user.userId,
        createdAt: new Date().toISOString(),
      }));

      for (let i = 0; i < items.length; i += 25) {
        const batch = items.slice(i, i + 25);
        await docClient.send(new BatchWriteCommand({
          RequestItems: { [TABLE]: batch.map((item: any) => ({ PutRequest: { Item: item } })) },
        }));
      }
      return created({ message: 'Attendance marked', count: items.length });
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);