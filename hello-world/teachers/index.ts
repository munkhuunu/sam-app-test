import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { enforceSchoolTenant } from '../middleware/tenant';
import { validateCreateTeacher, validateTeacherSubjectAssignment } from '../validators';
import { ok, created, noContent, errorResponse } from '../utils/response';
import { NotFoundError, BadRequestError } from '../utils/errors';
import { withAccessLog } from '../middleware/accessLog';

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const path = event.path;
    const body = JSON.parse(event.body ?? '{}');
    const schoolId = event.pathParameters?.schoolId ?? user.schoolId;
    if (!schoolId) throw new BadRequestError('schoolId required');
    enforceSchoolTenant(user, schoolId);

    // GET /schools/{schoolId}/teachers — багш нар + assignments тоо
    if (method === 'GET' && !path.endsWith('/assign')) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER']);
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `SCHOOL#${schoolId}#TEACHERS`,
          ':sk': 'TEACHER#',
        },
      }));
      const teachers = result.Items ?? [];

      // Багш бүрд assignment-уудын тоог нэгтгэн оруулах (lookup item-аар)
      const enriched = await Promise.all(teachers.map(async t => {
        const assigns = await docClient.send(new QueryCommand({
          TableName: TABLE, IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `TEACHER#${t.teacherId}`,
            ':sk': 'CLASS#',
          },
          Select: 'COUNT',
        }));
        return { ...t, assignmentCount: assigns.Count ?? 0 };
      }));
      return ok(enriched);
    }

    // POST /schools/{schoolId}/teachers — багш үүсгэх
    if (method === 'POST' && !path.endsWith('/assign')) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER']);
      validateCreateTeacher(body);
      const teacherId = randomUUID();
      const item = {
        PK: `SCHOOL#${schoolId}`, SK: `TEACHER#${teacherId}`,
        GSI1PK: `SCHOOL#${schoolId}#TEACHERS`, GSI1SK: `TEACHER#${teacherId}`,
        GSI2PK: `TEACHER#${teacherId}`, GSI2SK: `TEACHER#${teacherId}`,
        entityType: 'TEACHER', teacherId, schoolId,
        firstName: body.firstName, lastName: body.lastName,
        email: body.email ?? null, phone: body.phone ?? null,
        createdAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
      return created(item);
    }

    // POST /schools/{schoolId}/teachers/assign — атомар, race condition үгүй
    if (method === 'POST' && path.endsWith('/assign')) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER']);
      validateTeacherSubjectAssignment(body);

      // Багш байгаа эсэх + сургуульд харьяалагдсан эсэх
      const teacherResult = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `TEACHER#${body.teacherId}`,
          ':sk': 'TEACHER#',
        },
        Limit: 1,
      }));
      const teacher = teacherResult.Items?.[0];
      if (!teacher) throw new NotFoundError('Teacher not found');
      if (teacher.schoolId !== schoolId)
        throw new BadRequestError('Teacher not in this school');

      // Зөвхөн lookup item үүсгэх — атомар, давхардал боломжгүй (PK + SK)
      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `SCHOOL#${schoolId}`,
          SK: `TASSIGN#${body.teacherId}#${body.classId}#${body.subjectId}`,
          GSI1PK: `CLASS#${body.classId}`,
          GSI1SK: `TEACHER#${body.teacherId}#SUBJ#${body.subjectId}`,
          GSI2PK: `TEACHER#${body.teacherId}`,
          GSI2SK: `CLASS#${body.classId}#SUBJ#${body.subjectId}`,
          entityType: 'TEACHER_ASSIGNMENT',
          schoolId,
          teacherId: body.teacherId,
          classId: body.classId,
          subjectId: body.subjectId,
          createdAt: new Date().toISOString(),
        },
      }));
      return ok({
        message: 'Teacher assigned',
        teacherId: body.teacherId,
        classId: body.classId,
        subjectId: body.subjectId,
      });
    }

    // DELETE /schools/{schoolId}/teachers/{teacherId}/assign — assignment устгах
    if (method === 'DELETE' && path.endsWith('/assign')) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER']);
      if (!body.teacherId || !body.classId || !body.subjectId)
        throw new BadRequestError('teacherId, classId, subjectId required');
      await docClient.send(new DeleteCommand({
        TableName: TABLE,
        Key: {
          PK: `SCHOOL#${schoolId}`,
          SK: `TASSIGN#${body.teacherId}#${body.classId}#${body.subjectId}`,
        },
      }));
      return noContent();
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);
