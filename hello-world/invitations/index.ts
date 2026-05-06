import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { enforceSchoolTenant } from '../middleware/tenant';
import { validateCreateInvitation } from '../validators';
import { ok, created, errorResponse } from '../utils/response';
import { NotFoundError } from '../utils/errors';
import { withAccessLog } from '../middleware/accessLog';

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const path = event.path;
    const body = JSON.parse(event.body ?? '{}');
    const schoolId = event.pathParameters?.schoolId;
    const tokenParam = event.pathParameters?.token;

    // Public: validate invite token (no auth required)
    if (method === 'GET' && path.includes('/invitations/validate/')) {
      if (!tokenParam) return errorResponse({ statusCode: 400, message: 'token required' });
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `INVITE#${tokenParam}` },
      }));
      const invite = result.Items?.[0];
      if (!invite) return errorResponse({ statusCode: 404, message: 'Invitation not found' });
      if (invite.usedAt) return errorResponse({ statusCode: 410, message: 'Invitation already used' });
      if (invite.revokedAt) return errorResponse({ statusCode: 410, message: 'Invitation revoked' });
      if (new Date(invite.expiresAt) < new Date()) return errorResponse({ statusCode: 410, message: 'Invitation expired' });
      return ok({ valid: true, role: invite.role, schoolId: invite.schoolId, email: invite.email ?? null });
    }

    const user = await authenticate(event);

    // GET /schools/{schoolId}/invitations
    if (method === 'GET' && schoolId) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER']);
      enforceSchoolTenant(user, schoolId);
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `SCHOOL#${schoolId}`, ':sk': 'INVITE#' },
      }));
      return ok(result.Items ?? []);
    }

    // POST /schools/{schoolId}/invitations
    if (method === 'POST' && schoolId) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER']);
      enforceSchoolTenant(user, schoolId);
      validateCreateInvitation(body);
      const inviteToken = randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const item = {
        PK: `SCHOOL#${schoolId}`, SK: `INVITE#${inviteToken}`,
        GSI1PK: `INVITE#${inviteToken}`, GSI1SK: `INVITE#${inviteToken}`,
        entityType: 'INVITATION', token: inviteToken, schoolId,
        role: body.role, email: body.email ?? null,
        expiresAt, createdBy: user.userId,
        createdAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
      return created(item);
    }

    // DELETE /schools/{schoolId}/invitations/{token}
    if (method === 'DELETE' && schoolId && tokenParam) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER']);
      enforceSchoolTenant(user, schoolId);
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `INVITE#${tokenParam}` },
      }));
      const invite = result.Items?.[0];
      if (!invite) throw new NotFoundError('Invitation not found');
      await docClient.send(new UpdateCommand({
        TableName: TABLE, Key: { PK: invite.PK, SK: invite.SK },
        UpdateExpression: 'SET revokedAt = :now, revokedBy = :by',
        ExpressionAttributeValues: { ':now': new Date().toISOString(), ':by': user.userId },
      }));
      return ok({ message: 'Invitation revoked' });
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);
