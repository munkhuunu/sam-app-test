import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { validateAddGrade } from '../validators';
import { ok, created, errorResponse } from '../utils/response';

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const path = event.path;
    const body = JSON.parse(event.body ?? '{}');

    // GET /students/{studentId}/grades
    const studentMatch = path.match(/\/students\/([^\/]+)\/grades/);
    if (method === 'GET' && studentMatch) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER', 'PARENT', 'STUDENT']);
      const studentId = studentMatch[1];
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: { ':pk': `STUDENT#${studentId}#GRADES`, ':sk': 'GRADE#' },
      }));
      return ok(result.Items ?? []);
    }

    // GET /grades?classId=xxx&subjectId=yyy
    if (method === 'GET' && path === '/grades') {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      const classId = event.queryStringParameters?.classId;
      if (!classId) return errorResponse({ statusCode: 400, message: 'classId required' });

      const subjectId = event.queryStringParameters?.subjectId;
      let keyExpr = 'GSI2PK = :pk';
      const exprValues: Record<string, any> = { ':pk': `CLASS#${classId}#GRADES` };

      if (subjectId) {
        keyExpr += ' AND begins_with(GSI2SK, :sk)';
        exprValues[':sk'] = `SUBJECT#${subjectId}`;
      }

      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI2',
        KeyConditionExpression: keyExpr,
        ExpressionAttributeValues: exprValues,
      }));
      return ok(result.Items ?? []);
    }

    // POST /grades
    if (method === 'POST' && path === '/grades') {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      validateAddGrade(body);

      const gradeId = randomUUID();
      const item = {
        PK: `STUDENT#${body.studentId}`,
        SK: `GRADE#${gradeId}`,
        GSI1PK: `STUDENT#${body.studentId}#GRADES`,
        GSI1SK: `GRADE#${body.subjectId}#${gradeId}`,
        GSI2PK: `CLASS#${body.classId}#GRADES`,
        GSI2SK: `SUBJECT#${body.subjectId}#STUDENT#${body.studentId}`,
        entityType: 'GRADE',
        gradeId,
        studentId: body.studentId,
        classId: body.classId,
        subjectId: body.subjectId,
        score: body.score,
        term: body.term ?? 'Q1',
        comment: body.comment ?? null,
        teacherId: user.userId,
        createdAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
      return created(item);
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};
