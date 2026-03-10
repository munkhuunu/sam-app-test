import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const studentId = event.pathParameters?.studentId;
    if (!studentId) {
      return { statusCode: 400, body: JSON.stringify({ message: 'studentId required' }) };
    }

    // 1. Сурагч авах
    const studentResult = await client.send(
      new GetCommand({
        TableName: process.env.STUDENTS_TABLE!,
        Key: { studentId },
      })
    );

    if (!studentResult.Item) {
      return { statusCode: 404, body: JSON.stringify({ message: 'Student not found' }) };
    }

    const student = studentResult.Item;

    // 2. Анги авах
    const classResult = await client.send(
      new GetCommand({
        TableName: process.env.CLASSES_TABLE!,
        Key: { classId: student.classId },
      })
    );

    // 3. Сургууль авах
    const schoolResult = await client.send(
      new GetCommand({
        TableName: process.env.SCHOOLS_TABLE!,
        Key: { schoolId: student.schoolId },
      })
    );

    // 4. Хамт буцаана
    return {
      statusCode: 200,
      body: JSON.stringify({
        studentId: student.studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        phone: student.phone,
        email: student.email,
        createdAt: student.createdAt,
        class: classResult.Item ?? null,
        school: schoolResult.Item ?? null,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Error' }) };
  }
};