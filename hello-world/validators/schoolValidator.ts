import { BadRequestError } from '../utils/errors';

export const validateCreateSchool = (body: any) => {
  if (!body.name) {
    throw new BadRequestError('name required');
  }
  if (body.name.length < 2) {
    throw new BadRequestError('name must be at least 2 characters');
  }
};