import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const schoolId = event.pathParameters?.schoolId;
    if (!schoolId) {
      return { statusCode: 400, body: JSON.stringify({ message: 'schoolId required' }) };
    }
    const body = JSON.parse(event.body ?? '{}');
    const newClass = {
      classId: randomUUID(),
      schoolId,
      name: body.name,
      grade: body.grade,
      createdAt: new Date().toISOString(),
    };
    await client.send(
      new PutCommand({ TableName: process.env.CLASSES_TABLE!, Item: newClass })
    );
    return { statusCode: 201, body: JSON.stringify(newClass) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Error' }) };
  }
};