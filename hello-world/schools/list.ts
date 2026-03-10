import { APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const lambdaHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const result = await client.send(
      new ScanCommand({ TableName: process.env.SCHOOLS_TABLE! })
    );
    return { statusCode: 200, body: JSON.stringify(result.Items ?? []) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Error' }) };
  }
};