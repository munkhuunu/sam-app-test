import { BadRequestError } from '../utils/errors';

export const validateCreateStudent = (body: any) => {
  if (!body.classId || !body.schoolId || !body.firstName || !body.lastName) {
    throw new BadRequestError('classId, schoolId, firstName, lastName required');
  }

  if (body.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      throw new BadRequestError('Invalid email format');
    }
  }

  if (body.phone) {
    const phoneRegex = /^[0-9]{8}$/;
    if (!phoneRegex.test(body.phone)) {
      throw new BadRequestError('Phone must be 8 digits');
    }
  }
};

export const validateUpdateStudent = (body: any) => {
  if (Object.keys(body).length === 0) {
    throw new BadRequestError('No fields to update');
  }

  if (body.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      throw new BadRequestError('Invalid email format');
    }
  }

  if (body.phone) {
    const phoneRegex = /^[0-9]{8}$/;
    if (!phoneRegex.test(body.phone)) {
      throw new BadRequestError('Phone must be 8 digits');
    }
  }
};