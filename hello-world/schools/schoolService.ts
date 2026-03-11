import { randomUUID } from 'crypto';
import { SchoolRepository } from './schoolRepository';
import { validateCreateSchool } from '../validators/schoolValidator';
import { NotFoundError } from '../utils/errors';

const repo = new SchoolRepository();

export class SchoolService {

  async listSchools() {
    return repo.findAll();
  }

  async getSchoolById(schoolId: string) {
    const school = await repo.findById(schoolId);
    if (!school) throw new NotFoundError('School not found');
    return school;
  }

  async createSchool(body: any) {
    validateCreateSchool(body);

    const school = {
      schoolId: randomUUID(),
      name: body.name,
      createdAt: new Date().toISOString(),
    };

    return repo.save(school);
  }
}