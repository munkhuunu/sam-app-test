import { QueryCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../libs/dynamodb';

const CLASSES_TABLE = process.env.CLASSES_TABLE!;
const SCHOOLS_TABLE = process.env.SCHOOLS_TABLE!;

export class ClassRepository {

  async findBySchoolId(schoolId: string) {
    const result = await docClient.send(
      new QueryCommand({
        TableName: CLASSES_TABLE,
        IndexName: 'schoolId-index',
        KeyConditionExpression: 'schoolId = :sid',
        ExpressionAttributeValues: { ':sid': schoolId },
      })
    );
    return result.Items ?? [];
  }

  async findById(classId: string) {
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

  async save(newClass: any) {
    await docClient.send(
      new PutCommand({ TableName: CLASSES_TABLE, Item: newClass })
    );
    return newClass;
  }
}