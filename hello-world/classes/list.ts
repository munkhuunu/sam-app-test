import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const schoolId = event.pathParameters?.schoolId;
    if (!schoolId) {
      return { statusCode: 400, body: JSON.stringify({ message: 'schoolId required' }) };
    }
    const result = await client.send(
      new QueryCommand({
        TableName: process.env.CLASSES_TABLE!,
        IndexName: 'schoolId-index',
        KeyConditionExpression: 'schoolId = :sid',
        ExpressionAttributeValues: { ':sid': schoolId },
      })
    );
    return { statusCode: 200, body: JSON.stringify(result.Items ?? []) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Error' }) };
  }
};