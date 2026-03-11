import { QueryCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../libs/dynamodb';

const TABLE = process.env.USERS_TABLE!;

export class AuthRepository {

  async findByEmail(email: string) {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'email-index',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': email },
      })
    );
    return result.Items?.[0] ?? null;
  }

  async findById(userId: string) {
    const result = await docClient.send(
      new GetCommand({ TableName: TABLE, Key: { userId } })
    );
    return result.Item ?? null;
  }

  async save(user: any) {
    await docClient.send(
      new PutCommand({ TableName: TABLE, Item: user })
    );
    return user;
  }
}