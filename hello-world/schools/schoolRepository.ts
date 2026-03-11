import { ScanCommand, PutCommand, GetCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../libs/dynamodb';

const TABLE = process.env.SCHOOLS_TABLE!;

export class SchoolRepository {

  async findAll() {
    const result = await docClient.send(
      new ScanCommand({ TableName: TABLE })
    );
    return result.Items ?? [];
  }

  async findById(schoolId: string) {
    const result = await docClient.send(
      new GetCommand({ TableName: TABLE, Key: { schoolId } })
    );
    return result.Item ?? null;
  }

  async save(school: any) {
    await docClient.send(
      new PutCommand({ TableName: TABLE, Item: school })
    );
    return school;
  }

  async update(schoolId: string, fields: any) {
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
        TableName: TABLE,
        Key: { schoolId },
        UpdateExpression: `SET ${updates.join(', ')}`,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      })
    );
    return result.Attributes;
  }

  async delete(schoolId: string) {
    await docClient.send(
      new DeleteCommand({ TableName: TABLE, Key: { schoolId } })
    );
  }
}