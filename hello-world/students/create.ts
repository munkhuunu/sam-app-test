import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const student = {
      studentId: randomUUID(),
      classId: body.classId,
      schoolId: body.schoolId,
      lastName: body.lastName,
      firstName: body.firstName,
      phone: body.phone,
      email: body.email,
      createdAt: new Date().toISOString(),
    };
    await client.send(
      new PutCommand({ TableName: process.env.STUDENTS_TABLE!, Item: student })
    );
    return { statusCode: 201, body: JSON.stringify(student) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Error' }) };
  }
};