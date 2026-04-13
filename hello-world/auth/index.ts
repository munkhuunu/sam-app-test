import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { getJwtSecret } from '../libs/ssm';
import { validateRegister, validateLogin } from '../validators';
import { ok, created, errorResponse } from '../utils/response';
import { ConflictError, UnauthorizedError } from '../utils/errors';
import { withAccessLog } from '../middleware/accessLog';

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const path = event.path;
    const body = JSON.parse(event.body ?? '{}');

    if (method === 'POST' && path.endsWith('/register')) {
      validateRegister(body);
      const existing = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `EMAIL#${body.email}` },
      }));
      if (existing.Items?.length) throw new ConflictError('Email already exists');

      const userId = randomUUID();
      const hashedPassword = await bcrypt.hash(body.password, 10);
      const user = {
        PK: `USER#${userId}`, SK: `USER#${userId}`,
        GSI1PK: `EMAIL#${body.email}`, GSI1SK: `USER#${userId}`,
        entityType: 'USER', userId,
        email: body.email, password: hashedPassword,
        role: body.role, schoolId: body.schoolId ?? null,
        classId: body.classId ?? null, studentId: body.studentId ?? null,
        createdAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE, Item: user }));
      const { password, PK, SK, GSI1PK, GSI1SK, ...safe } = user;
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
      const token = jwt.sign({
        userId: user.userId, email: user.email, role: user.role,
        schoolId: user.schoolId, classId: user.classId, studentId: user.studentId,
      }, secret, { expiresIn: '8h' });
      return ok({ token, user: { userId: user.userId, email: user.email, role: user.role } });
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);