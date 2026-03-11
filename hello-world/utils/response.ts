const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

export const ok = (data: unknown) => ({
  statusCode: 200,
  headers: CORS_HEADERS,
  body: JSON.stringify(data),
});

export const created = (data: unknown) => ({
  statusCode: 201,
  headers: CORS_HEADERS,
  body: JSON.stringify(data),
});

export const noContent = () => ({
  statusCode: 204,
  headers: CORS_HEADERS,
  body: '',
});

export const errorResponse = (err: any) => ({
  statusCode: err.statusCode ?? 500,
  headers: CORS_HEADERS,
  body: JSON.stringify({ message: err.message ?? 'Internal server error' }),
});