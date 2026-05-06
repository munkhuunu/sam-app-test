import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { enforceSchoolTenant } from '../middleware/tenant';
import { validateLinkParentStudent } from '../validators';
import { ok, created, noContent, errorResponse } from '../utils/response';
import { withAccessLog } from '../middleware/accessLog';

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const body = JSON.parse(event.body ?? '{}');
    const schoolId = event.pathParameters?.schoolId ?? user.schoolId ?? '';
    const parentId = event.pathParameters?.parentId;
    const studentId = event.pathParameters?.studentId;
    const path = event.path;

    enforceSchoolTenant(user, schoolId);

    // GET /schools/{schoolId}/parents/{parentId}/students
    if (method === 'GET' && parentId && !path.endsWith('/parents')) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER', 'PARENT']);
      if (user.role === 'PARENT' && user.userId !== parentId)
        return errorResponse({ statusCode: 403, message: 'Forbidden' });
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: { ':pk': `PARENT#${parentId}`, ':sk': 'STUDENT#' },
      }));
      return ok(result.Items ?? []);
    }

    // GET /schools/{schoolId}/students/{studentId}/parents
    if (method === 'GET' && studentId && path.endsWith('/parents')) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER']);
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
        ExpressionAttributeValues: { ':pk': `STUDENT#${studentId}`, ':sk': 'PARENT#' },
      }));
      return ok(result.Items ?? []);
    }

    // POST /schools/{schoolId}/parents/{parentId}/students
    if (method === 'POST' && parentId) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER']);
      validateLinkParentStudent(body);
      const item = {
        PK: `SCHOOL#${schoolId}`, SK: `PS#${parentId}#${body.studentId}`,
        GSI1PK: `PARENT#${parentId}`, GSI1SK: `STUDENT#${body.studentId}`,
        GSI2PK: `STUDENT#${body.studentId}`, GSI2SK: `PARENT#${parentId}`,
        entityType: 'PARENT_STUDENT',
        schoolId, parentId, studentId: body.studentId,
        createdBy: user.userId,
        createdAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
      return created(item);
    }

    // DELETE /schools/{schoolId}/parents/{parentId}/students/{studentId}
    if (method === 'DELETE' && parentId && studentId) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER']);
      await docClient.send(new DeleteCommand({
        TableName: TABLE,
        Key: { PK: `SCHOOL#${schoolId}`, SK: `PS#${parentId}#${studentId}` },
      }));
      return noContent();
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);
