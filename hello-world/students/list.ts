import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const classId = event.pathParameters?.classId;
    if (!classId) {
      return { statusCode: 400, body: JSON.stringify({ message: 'classId required' }) };
    }
    const result = await client.send(
      new QueryCommand({
        TableName: process.env.STUDENTS_TABLE!,
        IndexName: 'classId-index',
        KeyConditionExpression: 'classId = :cid',
        ExpressionAttributeValues: { ':cid': classId },
      })
    );
    return { statusCode: 200, body: JSON.stringify(result.Items ?? []) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Error' }) };
  }
};