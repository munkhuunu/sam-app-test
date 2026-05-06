import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient, TABLE } from '../libs/dynamodb';
import { authenticate, authorize } from '../middleware/auth';
import { enforceSchoolTenant } from '../middleware/tenant';
import { validateCreateAssignment, validateGradeAssignment } from '../validators';
import { ok, created, noContent, errorResponse } from '../utils/response';
import { ForbiddenError } from '../utils/errors';
import { withAccessLog } from '../middleware/accessLog';

const currentAcademicYear = () => {
  const y = new Date().getFullYear();
  return `${y}-${y + 1}`;
};

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = await authenticate(event);
    const method = event.httpMethod;
    const path = event.path;
    const body = JSON.parse(event.body ?? '{}');
    const schoolId = event.pathParameters?.schoolId ?? user.schoolId ?? '';
    const assignmentId = event.pathParameters?.assignmentId;
    const studentId = event.pathParameters?.studentId;

    enforceSchoolTenant(user, schoolId);

    // GET /schools/{schoolId}/students/{studentId}/grades
    if (method === 'GET' && studentId && path.endsWith('/grades')) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT']);
      if (user.role === 'STUDENT' && user.studentId !== studentId)
        throw new ForbiddenError('Access denied');
      const subjectId = event.queryStringParameters?.subjectId;
      const keyCondition = subjectId
        ? 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)'
        : 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)';
      const exprValues: Record<string, any> = {
        ':pk': `STUDENT#${studentId}`,
        ':sk': 'GRADE#',
      };
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: exprValues,
      }));
      const items = result.Items ?? [];
      return ok(subjectId ? items.filter(i => i.subjectId === subjectId) : items);
    }

    // GET /schools/{schoolId}/assignments?classId=&subjectId=
    if (method === 'GET' && !assignmentId && !studentId) {
      authorize(user, ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT']);
      const classId = event.queryStringParameters?.classId;
      const subjectId = event.queryStringParameters?.subjectId;
      if (!classId || !subjectId)
        return errorResponse({ statusCode: 400, message: 'classId and subjectId query params required' });
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: { ':pk': `CLASS#${classId}#SUBJ#${subjectId}`, ':sk': 'ASSIGN#' },
      }));
      return ok(result.Items ?? []);
    }

    // POST /schools/{schoolId}/assignments
    if (method === 'POST' && !assignmentId && !studentId) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      validateCreateAssignment(body);
      const id = randomUUID();
      const academicYear = body.academicYear ?? currentAcademicYear();
      const item = {
        PK: `SCHOOL#${schoolId}`, SK: `ASSIGN#${id}`,
        GSI1PK: `CLASS#${body.classId}#SUBJ#${body.subjectId}`, GSI1SK: `ASSIGN#${id}`,
        GSI2PK: `TEACHER#${user.userId}`, GSI2SK: `ASSIGN#${id}`,
        entityType: 'ASSIGNMENT', assignmentId: id,
        schoolId, classId: body.classId, subjectId: body.subjectId,
        title: body.title, description: body.description ?? null,
        type: body.type, maxScore: body.maxScore ?? 100,
        dueDate: body.dueDate ?? null, academicYear,
        teacherId: user.userId,
        createdAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
      return created(item);
    }

    // GET /schools/{schoolId}/assignments/{assignmentId}/grades
    if (method === 'GET' && assignmentId && path.endsWith('/grades')) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE, IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
        ExpressionAttributeValues: { ':pk': `ASSIGN#${assignmentId}`, ':sk': 'GRADE#' },
      }));
      return ok(result.Items ?? []);
    }

    // POST /schools/{schoolId}/assignments/{assignmentId}/grades
    if (method === 'POST' && assignmentId && path.endsWith('/grades')) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      validateGradeAssignment(body);
      const item = {
        PK: `SCHOOL#${schoolId}`, SK: `GRADE#${assignmentId}#STUDENT#${body.studentId}`,
        GSI1PK: `STUDENT#${body.studentId}`, GSI1SK: `GRADE#${assignmentId}`,
        GSI2PK: `ASSIGN#${assignmentId}`, GSI2SK: `GRADE#${body.studentId}`,
        entityType: 'GRADE', gradeId: randomUUID(),
        schoolId, assignmentId, studentId: body.studentId,
        subjectId: body.subjectId ?? null,
        score: body.score, maxScore: body.maxScore ?? 100,
        comment: body.comment ?? null, status: 'GRADED',
        gradedBy: user.userId, gradedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
      return created(item);
    }

    // PUT /schools/{schoolId}/assignments/{assignmentId}
    if (method === 'PUT' && assignmentId) {
      authorize(user, ['DIRECTOR', 'MANAGER', 'TEACHER']);
      const updates: string[] = [];
      const vals: Record<string, any> = {};
      if (body.title) { updates.push('title = :t'); vals[':t'] = body.title; }
      if (body.description !== undefined) { updates.push('description = :d'); vals[':d'] = body.description; }
      if (body.dueDate) { updates.push('dueDate = :dd'); vals[':dd'] = body.dueDate; }
      if (body.maxScore !== undefined) { updates.push('maxScore = :ms'); vals[':ms'] = body.maxScore; }
      if (!updates.length) return errorResponse({ statusCode: 400, message: 'No fields to update' });
      updates.push('updatedAt = :now'); vals[':now'] = new Date().toISOString();
      await docClient.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `SCHOOL#${schoolId}`, SK: `ASSIGN#${assignmentId}` },
        UpdateExpression: `SET ${updates.join(', ')}`,
        ExpressionAttributeValues: vals,
      }));
      return ok({ message: 'Updated' });
    }

    // DELETE /schools/{schoolId}/assignments/{assignmentId}
    if (method === 'DELETE' && assignmentId) {
      authorize(user, ['DIRECTOR', 'MANAGER']);
      await docClient.send(new DeleteCommand({
        TableName: TABLE,
        Key: { PK: `SCHOOL#${schoolId}`, SK: `ASSIGN#${assignmentId}` },
      }));
      return noContent();
    }

    return errorResponse({ statusCode: 404, message: 'Not found' });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const lambdaHandler = withAccessLog(handler);
