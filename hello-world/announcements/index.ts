import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { enforceSchoolTenant } from '../middleware/tenant';
import { validateCreateAnnouncement } from '../validators';
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
      const audience = event.queryStringParameters?.audience;
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `SCHOOL#${schoolId}`, ':sk': 'ANNOUNCE#' },
        ScanIndexForward: false,
        Limit: 50,
      }));
      const items = result.Items ?? [];
      const filtered = audience
        ? items.filter(i => i.audience === 'ALL' || i.audience === audience)
        : items;
      return ok(filtered);
    }

    if (method === 'POST') {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER']);
      validateCreateAnnouncement(body);
      const id = randomUUID();
      const ts = new Date().toISOString();
      const item = {
        PK: `SCHOOL#${schoolId}`, SK: `ANNOUNCE#${ts}#${id}`,
        GSI1PK: `SCHOOL#${schoolId}#ANNOUNCE`, GSI1SK: `ANNOUNCE#${id}`,
        entityType: 'ANNOUNCEMENT', announcementId: id,
        schoolId, title: body.title, content: body.content,
        audience: body.audience ?? 'ALL',
        authorId: user.userId, authorRole: user.role,
        createdAt: ts,
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
