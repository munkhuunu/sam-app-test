// dashboard/index.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { ok, errorResponse } from '../utils/response';
import { withAccessLog } from '../middleware/accessLog';

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);

    const [schools, classes, students, teachers, subjects] = await Promise.all([
      countByType('SCHOOL'), countByType('CLASS'), countByType('STUDENT'),
      countByType('TEACHER'), countByType('SUBJECT'),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const attendanceResult = await docClient.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'entityType = :et AND #d = :today',
      ExpressionAttributeNames: { '#d': 'date' },
      ExpressionAttributeValues: { ':et': 'ATTENDANCE', ':today': today },
      Select: 'COUNT',
    }));

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

export const lambdaHandler = withAccessLog(handler);

async function countByType(entityType: string): Promise<number> {
  const result = await docClient.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'entityType = :et',
    ExpressionAttributeValues: { ':et': entityType },
    Select: 'COUNT',
  }));
  return result.Count ?? 0;
}