import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE } from '../libs/dynamodb';

const RATE_LIMIT = 100;     // 100 хүсэлт
const WINDOW_SECONDS = 60;  // 60 секундэд

// SchoolTable-д хадгална — тусдаа table шаарддаггүй
// PK: RLIMIT#userId, SK: WINDOW#timestamp → TTL-тай автомат устна
export const checkRateLimit = async (userId: string) => {
  const now = Math.floor(Date.now() / 1000);
  const windowKey = Math.floor(now / WINDOW_SECONDS);
  const pk = `RLIMIT#${userId}`;
  const sk = `WINDOW#${windowKey}`;

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: pk, SK: sk },
    })
  );

  const count = result.Item?.count ?? 0;

  if (count >= RATE_LIMIT) {
    throw { statusCode: 429, message: 'Too many requests' };
  }

  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: pk,
        SK: sk,
        GSI1PK: `RLIMIT#${pk}`,
        GSI1SK: sk,
        count: count + 1,
        ttl: now + WINDOW_SECONDS * 2, // DynamoDB TTL
        entityType: 'RATE_LIMIT',
      },
    })
  );
};