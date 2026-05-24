import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { ok, errorResponse } from '../utils/response';
import { withAccessLog } from '../middleware/accessLog';

// GSI1PK = 'SCHOOLS' → бүх сургуулиуд
// GSI1PK = 'SCHOOL#{id}#TEACHERS' → багш нар
// GSI1PK = 'SCHOOL#{id}#SUBJECTS' → хичээлүүд
// entityType query-г Scan биш GSI1 дээр хийнэ

const countByGSI1 = async (gsi1pk: string): Promise<number> => {
  let count = 0;
  let lastKey: Record<string, any> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': gsi1pk },
      Select: 'COUNT',
      ExclusiveStartKey: lastKey,
    }));
    count += result.Count ?? 0;
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return count;
};

const countByMain = async (pk: string, skPrefix: string): Promise<number> => {
  let count = 0;
  let lastKey: Record<string, any> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk, ':sk': skPrefix },
      Select: 'COUNT',
      ExclusiveStartKey: lastKey,
    }));
    count += result.Count ?? 0;
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return count;
};

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER']);

    const schoolId = user.schoolId;
    const today = new Date().toISOString().slice(0, 10);

    if (user.role === 'SUPER_ADMIN') {
      // SUPER_ADMIN: нийт сургуулиудын тоо + нийт хэрэглэгчид
      const [schools] = await Promise.all([
        countByGSI1('SCHOOLS'),
      ]);
      return ok({ stats: { schools, classes: 0, students: 0, teachers: 0, subjects: 0, todayAttendance: 0 } });
    }

    if (!schoolId) return ok({ stats: { schools: 0, classes: 0, students: 0, teachers: 0, subjects: 0, todayAttendance: 0 } });

    // Сургуулийн хүрээнд GSI1/Main query ашилна — Scan ашиглахгүй
    const [classes, students, teachers, subjects, attendance] = await Promise.all([
      countByMain(`SCHOOL#${schoolId}`, 'CLASS#'),
      countByMain(`SCHOOL#${schoolId}`, 'STUDENT#'),
      countByGSI1(`SCHOOL#${schoolId}#TEACHERS`),
      countByGSI1(`SCHOOL#${schoolId}#SUBJECTS`),
      // Өнөөдрийн ирц: GSI1PK-д DATE хадгалдаг pattern байхгүй тул
      // class тус бүрд нэг query шаарддаг — тэгэхэд хэтэрхий олон класс байж болно.
      // Энд 0 буцааж, тусдаа /attendance?date=today endpoint дуудаж болно.
      Promise.resolve(0),
    ]);

    // Сүүлийн 5 assignment (grades-ийн оронд)
    const recentAssign = await docClient.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `SCHOOL#${schoolId}`, ':sk': 'ASSIGN#' },
      ScanIndexForward: false,
      Limit: 5,
    }));

    return ok({
      stats: { schools: 1, classes, students, teachers, subjects, todayAttendance: attendance },
      recentAssignments: recentAssign.Items ?? [],
    });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);