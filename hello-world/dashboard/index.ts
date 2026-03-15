import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { ok, errorResponse } from '../utils/response';

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);

    const [schools, classes, students, teachers, subjects] = await Promise.all([
      countByType('SCHOOL'),
      countByType('CLASS'),
      countByType('STUDENT'),
      countByType('TEACHER'),
      countByType('SUBJECT'),
    ]);

    // Өнөөдрийн ирц
    const today = new Date().toISOString().slice(0, 10);
    const attendanceResult = await docClient.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'entityType = :et AND #d = :today',
      ExpressionAttributeNames: { '#d': 'date' },
      ExpressionAttributeValues: { ':et': 'ATTENDANCE', ':today': today },
      Select: 'COUNT',
    }));

    // Сүүлийн 10 дүн
    const recentGrades = await docClient.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'entityType = :et',
      ExpressionAttributeValues: { ':et': 'GRADE' },
      Limit: 10,
    }));

    return ok({
      stats: {
        schools, classes, students, teachers, subjects,
        todayAttendance: attendanceResult.Count ?? 0,
      },
      recentGrades: recentGrades.Items ?? [],
    });
  } catch (err: any) {
    return errorResponse(err);
  }
};

async function countByType(entityType: string): Promise<number> {
  const result = await docClient.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'entityType = :et',
    ExpressionAttributeValues: { ':et': entityType },
    Select: 'COUNT',
  }));
  return result.Count ?? 0;
}
