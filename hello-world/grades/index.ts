// grades/index.ts — standalone grades handler
// assignments/index.ts дотор grade endpoint байгаа ч
// энэ файл нь /grades шууд route-д зориулагдсан
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { enforceSchoolTenant } from '../middleware/tenant';
import { ok, errorResponse } from '../utils/response';
import { ForbiddenError } from '../utils/errors';
import { withAccessLog } from '../middleware/accessLog';

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const schoolId = event.pathParameters?.schoolId ?? user.schoolId ?? '';
    const studentId = event.pathParameters?.studentId;

    enforceSchoolTenant(user, schoolId);

    // GET /schools/{schoolId}/students/{studentId}/grades
    if (method === 'GET' && studentId) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT']);
      if (user.role === 'STUDENT' && user.studentId !== studentId)
        throw new ForbiddenError('Access denied');

      const subjectId = event.queryStringParameters?.subjectId;
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `STUDENT#${studentId}`,
          ':sk': 'GRADE#',
        },
      }));
      const items = result.Items ?? [];
      return ok(subjectId ? items.filter(i => i.subjectId === subjectId) : items);
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);