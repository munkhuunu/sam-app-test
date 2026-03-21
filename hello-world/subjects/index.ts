import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { validateCreateSubject } from '../validators';
import { ok, created, errorResponse } from '../utils/response';

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const path = event.path;
    const body = JSON.parse(event.body ?? '{}');

    if (method === 'GET' && path === '/subjects') {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      const schoolId = event.queryStringParameters?.schoolId;
      if (!schoolId) return errorResponse({ statusCode: 400, message: 'schoolId required' });

      const result = await docClient.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: { ':pk': `SCHOOL#${schoolId}#SUBJECTS`, ':sk': 'SUBJECT#' },
      }));
      return ok(result.Items ?? []);
    }

    if (method === 'POST' && path === '/subjects') {
      authorize(user, ['DIRECTOR', 'MANAGER']);
      validateCreateSubject(body);

      const subjectId = randomUUID();
      const item = {
        PK: `SCHOOL#${body.schoolId}`,
        SK: `SUBJECT#${subjectId}`,
        GSI1PK: `SCHOOL#${body.schoolId}#SUBJECTS`,
        GSI1SK: `SUBJECT#${subjectId}`,
        entityType: 'SUBJECT',
        subjectId,
        schoolId: body.schoolId,
        name: body.name,
        description: body.description ?? null,
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
