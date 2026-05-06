import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { enforceSchoolTenant } from '../middleware/tenant';
import { validateCreateSchool, validateCreateClass } from '../validators';
import { ok, created, errorResponse } from '../utils/response';
import { NotFoundError } from '../utils/errors';
import { withAccessLog } from '../middleware/accessLog';

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const path = event.path;
    const body = JSON.parse(event.body ?? '{}');

    if (path.includes('/classes')) {
      const match = path.match(/\/schools\/([^\/]+)\/classes/);
      const schoolId = match?.[1];
      if (!schoolId) return errorResponse({ statusCode: 400, message: 'Missing schoolId' });
      enforceSchoolTenant(user, schoolId);

      if (method === 'GET') {
        authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT']);
        const result = await docClient.send(new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': `SCHOOL#${schoolId}`, ':sk': 'CLASS#' },
        }));
        return ok(result.Items ?? []);
      }

      if (method === 'POST') {
        authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER']);
        validateCreateClass(body);
        const school = await docClient.send(new GetCommand({
          TableName: TABLE, Key: { PK: `SCHOOL#${schoolId}`, SK: `SCHOOL#${schoolId}` },
        }));
        if (!school.Item) throw new NotFoundError('School not found');
        const classId = randomUUID();
        const item = {
          PK: `SCHOOL#${schoolId}`, SK: `CLASS#${classId}`,
          GSI1PK: `CLASS#${classId}`, GSI1SK: `CLASS#${classId}`,
          entityType: 'CLASS', classId, schoolId,
          name: body.name, grade: body.grade,
          academicYear: body.academicYear ?? null,
          createdAt: new Date().toISOString(),
        };
        await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
        return created(item);
      }
    }

    if (method === 'GET' && (path === '/schools' || path.endsWith('/schools'))) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER']);
      if (user.role === 'SUPER_ADMIN') {
        const result = await docClient.send(new QueryCommand({
          TableName: TABLE, IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': 'SCHOOLS' },
        }));
        return ok(result.Items ?? []);
      }
      if (!user.schoolId) return ok([]);
      const result = await docClient.send(new GetCommand({
        TableName: TABLE, Key: { PK: `SCHOOL#${user.schoolId}`, SK: `SCHOOL#${user.schoolId}` },
      }));
      return ok(result.Item ? [result.Item] : []);
    }

    const schoolIdParam = event.pathParameters?.schoolId;
    if (method === 'GET' && schoolIdParam && !path.includes('/classes')) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER']);
      enforceSchoolTenant(user, schoolIdParam);
      const result = await docClient.send(new GetCommand({
        TableName: TABLE, Key: { PK: `SCHOOL#${schoolIdParam}`, SK: `SCHOOL#${schoolIdParam}` },
      }));
      if (!result.Item) throw new NotFoundError('School not found');
      return ok(result.Item);
    }

    if (method === 'POST' && (path === '/schools' || path.endsWith('/schools'))) {
      authorize(user, ['SUPER_ADMIN']);
      validateCreateSchool(body);
      const schoolId = randomUUID();
      const item = {
        PK: `SCHOOL#${schoolId}`, SK: `SCHOOL#${schoolId}`,
        GSI1PK: 'SCHOOLS', GSI1SK: `SCHOOL#${schoolId}`,
        entityType: 'SCHOOL', schoolId,
        name: body.name, address: body.address ?? null,
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
