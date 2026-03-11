import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from '../libs/dynamodb';

const STUDENTS_TABLE = process.env.STUDENTS_TABLE!;
const CLASSES_TABLE  = process.env.CLASSES_TABLE!;
const SCHOOLS_TABLE  = process.env.SCHOOLS_TABLE!;

export class StudentRepository {

  async findById(studentId: string) {
    const result = await docClient.send(
      new GetCommand({ TableName: STUDENTS_TABLE, Key: { studentId } })
    );
    return result.Item ?? null;
  }

  async findByClassId(classId: string) {
    const result = await docClient.send(
      new QueryCommand({
        TableName: STUDENTS_TABLE,
        IndexName: 'classId-index',
        KeyConditionExpression: 'classId = :cid',
        ExpressionAttributeValues: { ':cid': classId },
      })
    );
    return result.Items ?? [];
  }

  async findBySchoolId(schoolId: string) {
    const result = await docClient.send(
      new QueryCommand({
        TableName: STUDENTS_TABLE,
        IndexName: 'schoolId-index',
        KeyConditionExpression: 'schoolId = :sid',
        ExpressionAttributeValues: { ':sid': schoolId },
      })
    );
    return result.Items ?? [];
  }

  async save(student: any) {
    await docClient.send(
      new PutCommand({ TableName: STUDENTS_TABLE, Item: student })
    );
    return student;
  }

  async update(studentId: string, fields: any) {
    const updates: string[] = [];
    const values: Record<string, any> = {
      ':updatedAt': new Date().toISOString(),
    };

    Object.keys(fields).forEach(key => {
      updates.push(`${key} = :${key}`);
      values[`:${key}`] = fields[key];
    });
    updates.push('updatedAt = :updatedAt');

    const result = await docClient.send(
      new UpdateCommand({
        TableName: STUDENTS_TABLE,
        Key: { studentId },
        UpdateExpression: `SET ${updates.join(', ')}`,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      })
    );
    return result.Attributes;
  }

  async delete(studentId: string) {
    await docClient.send(
      new DeleteCommand({ TableName: STUDENTS_TABLE, Key: { studentId } })
    );
  }

  async findClassById(classId: string) {
    const result = await docClient.send(
      new GetCommand({ TableName: CLASSES_TABLE, Key: { classId } })
    );
    return result.Item ?? null;
  }

  async findSchoolById(schoolId: string) {
    const result = await docClient.send(
      new GetCommand({ TableName: SCHOOLS_TABLE, Key: { schoolId } })
    );
    return result.Item ?? null;
  }
}