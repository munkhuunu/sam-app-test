import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, BatchWriteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { validateMarkAttendance } from '../validators';
import { ok, created, errorResponse } from '../utils/response';
import { ForbiddenError, BadRequestError } from '../utils/errors';
import { withAccessLog } from '../middleware/accessLog';

const getLinkedStudents = async (parentId: string): Promise<string[]> => {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE, IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
    ExpressionAttributeValues: { ':pk': `PARENT#${parentId}`, ':sk': 'STUDENT#' },
  }));
  return (result.Items ?? []).map(i => i.studentId);
};

const assertClassInSchool = async (schoolId: string, classId: string) => {
  const item = await docClient.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `SCHOOL#${schoolId}`, SK: `CLASS#${classId}` },
  }));
  if (!item.Item) throw new ForbiddenError('Class not found in your school');
};

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const path = event.path;
    const body = JSON.parse(event.body ?? '{}');
    const studentIdParam = event.pathParameters?.studentId;

    // ─── GET /attendance?classId=&date= (class-аар) ────────────────────────
    if (method === 'GET' && path === '/attendance') {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER']);
      const classId = event.queryStringParameters?.classId;
      const date = event.queryStringParameters?.date;
      if (!classId) throw new BadRequestError('classId required');

      if (user.role !== 'SUPER_ADMIN') {
        if (!user.schoolId) throw new ForbiddenError('No school assigned');
        await assertClassInSchool(user.schoolId, classId);
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

    // ─── GET /attendance/{studentId} (нэг сурагчийн ирц) ────────────────────
    if (method === 'GET' && studentIdParam) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER', 'PARENT', 'STUDENT']);

      // Tenant check — STUDENT/PARENT-д өөрийн хувийн эрх
      if (user.role === 'STUDENT' && user.studentId !== studentIdParam)
        throw new ForbiddenError('Access denied');
      if (user.role === 'PARENT') {
        const linked = await getLinkedStudents(user.userId);
        if (!linked.includes(studentIdParam)) throw new ForbiddenError('Access denied');
      }

      // STAFF (TEACHER/MANAGER/DIRECTOR)-д сурагч сургуульд харьяалагдаж байгаа эсэх
      if (['TEACHER', 'MANAGER', 'DIRECTOR'].includes(user.role)) {
        if (!user.schoolId) throw new ForbiddenError('No school assigned');
        const studentLookup = await docClient.send(new QueryCommand({
          TableName: TABLE, IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: { ':pk': `STUDENT#${studentIdParam}` },
          Limit: 1,
        }));
        const student = studentLookup.Items?.[0];
        if (!student || student.schoolId !== user.schoolId)
          throw new ForbiddenError('Student not in your school');
      }

      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `STUDENT#${studentIdParam}#ATTENDANCE` },
      }));
      return ok(result.Items ?? []);
    }

    // ─── POST /attendance (ирц тэмдэглэх) ──────────────────────────────────
    if (method === 'POST' && path === '/attendance') {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER']);
      validateMarkAttendance(body);

      if (user.role !== 'SUPER_ADMIN') {
        if (!user.schoolId) throw new ForbiddenError('No school assigned');
        await assertClassInSchool(user.schoolId, body.classId);
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

      // UnprocessedItems retry-той batch write
      for (let i = 0; i < items.length; i += 25) {
        let unprocessed = items.slice(i, i + 25).map((item: any) => ({
          PutRequest: { Item: item },
        }));
        let retries = 0;
        while (unprocessed.length > 0 && retries < 5) {
          const res = await docClient.send(new BatchWriteCommand({
            RequestItems: { [TABLE]: unprocessed },
          }));
          unprocessed = (res.UnprocessedItems?.[TABLE] as any[]) ?? [];
          if (unprocessed.length > 0) {
            await new Promise(r => setTimeout(r, 100 * Math.pow(2, retries)));
            retries++;
          }
        }
        if (unprocessed.length > 0)
          throw new Error('BatchWrite failed after retries');
      }
      return created({ message: 'Attendance marked', count: items.length });
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);
