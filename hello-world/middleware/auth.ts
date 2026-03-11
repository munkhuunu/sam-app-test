import jwt from 'jsonwebtoken';

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
  schoolId?: string;
  classId?: string;
  studentId?: string;
}

export const authenticate = (event: any): AuthUser => {
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  if (!authHeader) {
    throw { statusCode: 401, message: 'Unauthorized' };
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
    return decoded;
  } catch {
    throw { statusCode: 401, message: 'Invalid token' };
  }
};

export const authorize = (user: AuthUser, roles: string[]) => {
  if (!roles.includes(user.role)) {
    throw { statusCode: 403, message: 'Forbidden' };
  }
};