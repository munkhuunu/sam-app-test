import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../libs/dynamodb';

const RATE_LIMIT = 100;       // 100 хүсэлт
const WINDOW_SECONDS = 60;    // 60 секундэд

export const checkRateLimit = async (userId: string) => {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - WINDOW_SECONDS;
  const key = `ratelimit:${userId}:${Math.floor(now / WINDOW_SECONDS)}`;

  const result = await docClient.send(
    new GetCommand({
      TableName: 'rate_limits',
      Key: { pk: key },
    })
  );

  const count = result.Item?.count ?? 0;

  if (count >= RATE_LIMIT) {
    throw { statusCode: 429, message: 'Too many requests' };
  }

  await docClient.send(
    new PutCommand({
      TableName: 'rate_limits',
      Item: {
        pk: key,
        count: count + 1,
        ttl: now + WINDOW_SECONDS * 2,  // DynamoDB TTL автоматаар устгана
      },
    })
  );
};