import { BadRequestError } from '../utils/errors';

export const validateRegister = (body: any) => {
  if (!body.email || !body.password || !body.role) {
    throw new BadRequestError('email, password, role required');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) {
    throw new BadRequestError('Invalid email format');
  }

  if (body.password.length < 6) {
    throw new BadRequestError('Password must be at least 6 characters');
  }

  const allowedRoles = ['DIRECTOR', 'MANAGER', 'TEACHER', 'PARENT', 'STUDENT'];
  if (!allowedRoles.includes(body.role)) {
    throw new BadRequestError('Invalid role');
  }
};

export const validateLogin = (body: any) => {
  if (!body.email || !body.password) {
    throw new BadRequestError('email, password required');
  }
};