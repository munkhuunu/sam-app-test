import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE } from '../libs/dynamodb';

const RATE_LIMIT = 100;     // 100 хүсэлт
const WINDOW_SECONDS = 60;  // 60 секундэд

/**
 * Атомар rate limit шалгалт. Race condition үгүй.
 * PK: RLIMIT#userId, SK: WINDOW#timestamp → TTL-тай автомат устна.
 */
export const checkRateLimit = async (userId: string): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  const windowKey = Math.floor(now / WINDOW_SECONDS);
  const pk = `RLIMIT#${userId}`;
  const sk = `WINDOW#${windowKey}`;

  try {
    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: pk, SK: sk },
      UpdateExpression:
        'ADD #c :one SET #ttl = if_not_exists(#ttl, :ttl), entityType = if_not_exists(entityType, :et)',
      ConditionExpression: 'attribute_not_exists(#c) OR #c < :limit',
      ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':one': 1,
        ':limit': RATE_LIMIT,
        ':ttl': now + WINDOW_SECONDS * 2,
        ':et': 'RATE_LIMIT',
      },
    }));
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      throw { statusCode: 429, message: 'Too many requests' };
    }
    throw err;
  }
};
