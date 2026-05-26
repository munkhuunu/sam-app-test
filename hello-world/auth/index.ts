import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
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

    // ─── REGISTER ───────────────────────────────────────────────────
    if (method === 'POST' && path.endsWith('/register')) {
      validateRegister(body);

      let role: string;
      let schoolId: string | null = null;
      let invitePK: string | null = null;
      let inviteSK: string | null = null;

      if (body.role === 'SUPER_ADMIN') {
        const existing = await docClient.send(new QueryCommand({
          TableName: TABLE, IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: { ':pk': 'ROLE#SUPER_ADMIN' },
          Limit: 1,
        }));
        if (existing.Items?.length) throw new ConflictError('Super admin already exists');
        role = 'SUPER_ADMIN';
      } else {
        if (!body.inviteToken) throw new BadRequestError('inviteToken required');
        const inviteResult = await docClient.send(new QueryCommand({
          TableName: TABLE, IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': `INVITE#${body.inviteToken}` },
          Limit: 1,
        }));
        const invite = inviteResult.Items?.[0];
        if (!invite) throw new BadRequestError('Invalid invitation');
        if (invite.usedAt) throw new BadRequestError('Invitation already used');
        if (invite.revokedAt) throw new BadRequestError('Invitation revoked');
        if (new Date(invite.expiresAt) < new Date()) throw new BadRequestError('Invitation expired');
        if (invite.email && invite.email !== body.email)
          throw new BadRequestError('Email does not match invitation');

        // role-ийг ЗӨВХӨН invite-ээс авна, body.role-ийг үл тоомсорлоно (security)
        role = invite.role;
        schoolId = invite.schoolId;
        invitePK = invite.PK;
        inviteSK = invite.SK;
      }

      // Email-ийн strong-consistent шалгалт (sentinel item-ээр)
      const emailLookup = await docClient.send(new GetCommand({
        TableName: TABLE,
        Key: { PK: `EMAIL#${body.email}`, SK: `EMAIL#${body.email}` },
      }));
      if (emailLookup.Item) throw new ConflictError('Email already exists');

      const userId = randomUUID();
      const hashedPassword = await bcrypt.hash(body.password, 10);
      const now = new Date().toISOString();

      const user: Record<string, any> = {
        PK: `USER#${userId}`, SK: `USER#${userId}`,
        GSI1PK: `EMAIL#${body.email}`, GSI1SK: `USER#${userId}`,
        entityType: 'USER', userId,
        email: body.email, password: hashedPassword,
        role, schoolId,
        createdAt: now,
      };
      if (role === 'SUPER_ADMIN') {
        user.GSI2PK = 'ROLE#SUPER_ADMIN';
        user.GSI2SK = `USER#${userId}`;
      }

      // Атомар: User үүсгэх + Email sentinel + Invite consume
      const transactItems: any[] = [
        {
          Put: {
            TableName: TABLE,
            Item: user,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              PK: `EMAIL#${body.email}`, SK: `EMAIL#${body.email}`,
              entityType: 'EMAIL_LOOKUP', userId, createdAt: now,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ];

      if (invitePK && inviteSK) {
        transactItems.push({
          Update: {
            TableName: TABLE,
            Key: { PK: invitePK, SK: inviteSK },
            UpdateExpression: 'SET usedAt = :now, usedByEmail = :email',
            ConditionExpression:
              'attribute_not_exists(usedAt) AND attribute_not_exists(revokedAt)',
            ExpressionAttributeValues: { ':now': now, ':email': body.email },
          },
        });
      }

      try {
        await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
      } catch (err: any) {
        if (err.name === 'TransactionCanceledException') {
          const reasons = err.CancellationReasons ?? [];
          if (reasons[0]?.Code === 'ConditionalCheckFailed')
            throw new ConflictError('User already exists');
          if (reasons[1]?.Code === 'ConditionalCheckFailed')
            throw new ConflictError('Email already exists');
          if (reasons[2]?.Code === 'ConditionalCheckFailed')
            throw new BadRequestError('Invitation already used or revoked');
        }
        throw err;
      }

      const { password: _pw, PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...safe } = user;
      void _pw; void PK; void SK; void GSI1PK; void GSI1SK; void GSI2PK; void GSI2SK;
      return created(safe);
    }

    // ─── LOGIN ──────────────────────────────────────────────────────
    if (method === 'POST' && path.endsWith('/login')) {
      validateLogin(body);
      const secret = await getJwtSecret();
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `EMAIL#${body.email}`,
          ':sk': 'USER#',
        },
        Limit: 1,
      }));
      const user = result.Items?.[0];
      if (!user) throw new UnauthorizedError('Invalid email or password');
      const isValid = await bcrypt.compare(body.password, user.password);
      if (!isValid) throw new UnauthorizedError('Invalid email or password');

      const token = jwt.sign(
        {
          userId: user.userId, email: user.email, role: user.role,
          schoolId: user.schoolId ?? null, studentId: user.studentId ?? null,
        },
        secret,
        { expiresIn: '8h' }
      );
      return ok({
        token,
        user: {
          userId: user.userId, email: user.email,
          role: user.role, schoolId: user.schoolId ?? null,
        },
      });
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);
