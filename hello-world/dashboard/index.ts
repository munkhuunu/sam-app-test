import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { ok, errorResponse } from '../utils/response';
import { withAccessLog } from '../middleware/accessLog';

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

const listSchoolIds = async (): Promise<string[]> => {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': 'SCHOOLS' },
    ProjectionExpression: 'schoolId',
  }));
  return (result.Items ?? []).map(i => i.schoolId);
};

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER']);

    // ─── SUPER_ADMIN: бүх сургуулийн нэгтгэсэн statistic ──────────────────
    if (user.role === 'SUPER_ADMIN') {
      const schoolIds = await listSchoolIds();
      const schools = schoolIds.length;

      // Бүх сургуулийн дотроос parallel-аар тоолох
      const [classes, students, teachers, subjects] = await Promise.all([
        Promise.all(schoolIds.map(id => countByMain(`SCHOOL#${id}`, 'CLASS#')))
          .then(arr => arr.reduce((a, b) => a + b, 0)),
        Promise.all(schoolIds.map(id => countByMain(`SCHOOL#${id}`, 'STUDENT#')))
          .then(arr => arr.reduce((a, b) => a + b, 0)),
        Promise.all(schoolIds.map(id => countByGSI1(`SCHOOL#${id}#TEACHERS`)))
          .then(arr => arr.reduce((a, b) => a + b, 0)),
        Promise.all(schoolIds.map(id => countByGSI1(`SCHOOL#${id}#SUBJECTS`)))
          .then(arr => arr.reduce((a, b) => a + b, 0)),
      ]);

      return ok({
        stats: { schools, classes, students, teachers, subjects, todayAttendance: 0 },
      });
    }

    // ─── School-scoped (DIRECTOR/MANAGER/TEACHER) ──────────────────────────
    const schoolId = user.schoolId;
    if (!schoolId) {
      return ok({
        stats: { schools: 0, classes: 0, students: 0, teachers: 0, subjects: 0, todayAttendance: 0 },
      });
    }

    const [classes, students, teachers, subjects] = await Promise.all([
      countByMain(`SCHOOL#${schoolId}`, 'CLASS#'),
      countByMain(`SCHOOL#${schoolId}`, 'STUDENT#'),
      countByGSI1(`SCHOOL#${schoolId}#TEACHERS`),
      countByGSI1(`SCHOOL#${schoolId}#SUBJECTS`),
    ]);

    const recentAssign = await docClient.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `SCHOOL#${schoolId}`, ':sk': 'ASSIGN#' },
      ScanIndexForward: false,
      Limit: 5,
    }));

    return ok({
      stats: { schools: 1, classes, students, teachers, subjects, todayAttendance: 0 },
      recentAssignments: recentAssign.Items ?? [],
    });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);
