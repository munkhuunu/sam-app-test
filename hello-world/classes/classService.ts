import { randomUUID } from 'crypto';
import { ClassRepository } from './classRepository';
import { validateCreateClass } from '../validators/classValidator';
import { NotFoundError } from '../utils/errors';

const repo = new ClassRepository();

export class ClassService {

  async listBySchool(schoolId: string) {
    const school = await repo.findSchoolById(schoolId);
    if (!school) throw new NotFoundError('School not found');
    return repo.findBySchoolId(schoolId);
  }

  async createClass(schoolId: string, body: any) {
    validateCreateClass(body);

    const school = await repo.findSchoolById(schoolId);
    if (!school) throw new NotFoundError('School not found');

    const newClass = {
      classId: randomUUID(),
      schoolId,
      name: body.name,
      grade: body.grade,
      createdAt: new Date().toISOString(),
    };

    return repo.save(newClass);
  }
}