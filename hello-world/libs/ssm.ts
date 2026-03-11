import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});
let cachedSecret: string | null = null;

export const getJwtSecret = async (): Promise<string> => {
  if (cachedSecret) return cachedSecret;  // cache-аас буцаах

  const result = await ssm.send(
    new GetParameterCommand({
      Name: '/sam-app-test/jwt-secret',
      WithDecryption: true,
    })
  );

  cachedSecret = result.Parameter!.Value!;
  return cachedSecret;
};