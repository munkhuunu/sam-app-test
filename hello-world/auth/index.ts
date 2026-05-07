import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { getJwtSecret } from '../libs/ssm';
import { validateRegister, validateLogin } from '../validators';
import { ok, created, errorResponse } from '../utils/response';
import { ConflictError, UnauthorizedError, BadRequestError } from '../utils/errors';
import { withAccessLog } from '../middleware/accessLog';

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const path = event.path;
    const body = JSON.parse(event.body ?? '{}');

    if (method === 'POST' && path.endsWith('/register')) {
      validateRegister(body);

      let schoolId: string | null = null;
      let role: string = body.role;

      if (role === 'SUPER_ADMIN') {
        const existing = await docClient.send(new QueryCommand({
          TableName: TABLE, IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: { ':pk': 'ROLE#SUPER_ADMIN' },
        }));
        if (existing.Items?.length) throw new ConflictError('Super admin already exists');
      } else {
        if (!body.inviteToken) throw new BadRequestError('inviteToken required');
        const inviteResult = await docClient.send(new QueryCommand({
          TableName: TABLE, IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': `INVITE#${body.inviteToken}` },
        }));
        const invite = inviteResult.Items?.[0];
        if (!invite) throw new BadRequestError('Invalid or expired invitation');
        if (invite.usedAt) throw new BadRequestError('Invitation already used');
        if (invite.revokedAt) throw new BadRequestError('Invitation revoked');
        if (new Date(invite.expiresAt) < new Date()) throw new BadRequestError('Invitation expired');
        if (invite.email && invite.email !== body.email)
          throw new BadRequestError('Email does not match invitation');
        role = invite.role;
        schoolId = invite.schoolId;
        await docClient.send(new UpdateCommand({
          TableName: TABLE,
          Key: { PK: invite.PK, SK: invite.SK },
          UpdateExpression: 'SET usedAt = :now, usedByEmail = :email',
          ExpressionAttributeValues: { ':now': new Date().toISOString(), ':email': body.email },
        }));
    
      }

      const emailCheck = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `EMAIL#${body.email}` },
      }));
      if (emailCheck.Items?.length) throw new ConflictError('Email already exists');

      const userId = randomUUID();
      const hashedPassword = await bcrypt.hash(body.password, 10);
      const user: Record<string, any> = {
        PK: `USER#${userId}`, SK: `USER#${userId}`,
        GSI1PK: `EMAIL#${body.email}`, GSI1SK: `USER#${userId}`,
        entityType: 'USER', userId,
        email: body.email, password: hashedPassword,
        role, schoolId,
        createdAt: new Date().toISOString(),
      };
      if (role === 'SUPER_ADMIN') {
        user.GSI2PK = 'ROLE#SUPER_ADMIN';
        user.GSI2SK = `USER#${userId}`;
      }
      await docClient.send(new PutCommand({ TableName: TABLE, Item: user }));
      const { password, PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...safe } = user;
      return created(safe);
    }

    if (method === 'POST' && path.endsWith('/login')) {
      validateLogin(body);
      const secret = await getJwtSecret();
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `EMAIL#${body.email}` },
      }));
      const user = result.Items?.[0];
      if (!user) throw new UnauthorizedError('Invalid email or password');
      const isValid = await bcrypt.compare(body.password, user.password);
      if (!isValid) throw new UnauthorizedError('Invalid email or password');
      const token = jwt.sign(
        { userId: user.userId, email: user.email, role: user.role, schoolId: user.schoolId ?? null, studentId: user.studentId ?? null },
        secret,
        { expiresIn: '8h' }
      );
      return ok({
        token,
        user: { userId: user.userId, email: user.email, role: user.role, schoolId: user.schoolId ?? null },
      });
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);
