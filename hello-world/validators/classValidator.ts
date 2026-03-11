import { BadRequestError } from '../utils/errors';

export const validateCreateClass = (body: any) => {
  if (!body.name || !body.grade) {
    throw new BadRequestError('name, grade required');
  }
  if (typeof body.grade !== 'number') {
    throw new BadRequestError('grade must be a number');
  }
  if (body.grade < 1 || body.grade > 12) {
    throw new BadRequestError('grade must be between 1 and 12');
  }
};  