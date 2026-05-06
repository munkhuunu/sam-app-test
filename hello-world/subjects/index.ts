import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { enforceSchoolTenant } from '../middleware/tenant';
import { ok, created, errorResponse } from '../utils/response';
import { withAccessLog } from '../middleware/accessLog';

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const body = JSON.parse(event.body ?? '{}');
    const schoolId = event.pathParameters?.schoolId ?? user.schoolId ?? '';

    enforceSchoolTenant(user, schoolId);

    if (method === 'GET') {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT']);
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: { ':pk': `SCHOOL#${schoolId}#SUBJECTS`, ':sk': 'SUBJECT#' },
      }));
      return ok(result.Items ?? []);
    }

    if (method === 'POST') {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER']);
      if (!body.name) return errorResponse({ statusCode: 400, message: 'name required' });
      const subjectId = randomUUID();
      const item = {
        PK: `SCHOOL#${schoolId}`, SK: `SUBJECT#${subjectId}`,
        GSI1PK: `SCHOOL#${schoolId}#SUBJECTS`, GSI1SK: `SUBJECT#${subjectId}`,
        entityType: 'SUBJECT', subjectId, schoolId,
        name: body.name, description: body.description ?? null,
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

export const lambdaHandler = withAccessLog(handler);
