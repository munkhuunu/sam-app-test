import { randomUUID } from 'crypto';
import { StudentRepository } from './studentRepository';
import { validateCreateStudent, validateUpdateStudent } from '../validators/studentValidator';
import { NotFoundError, ForbiddenError } from '../utils/errors';

const repo = new StudentRepository();

export class StudentService {

  async getStudentsByClass(classId: string) {
    const classInfo = await repo.findClassById(classId);
    if (!classInfo) throw new NotFoundError('Class not found');
    const students = await repo.findByClassId(classId);
    return { class: classInfo, students };
  }

  async getStudentById(studentId: string, requestUserId?: string, role?: string) {
    const student = await repo.findById(studentId);
    if (!student) throw new NotFoundError('Student not found');

    if (role === 'PARENT' && requestUserId !== studentId) {
      throw new ForbiddenError();
    }
    if (role === 'STUDENT' && requestUserId !== studentId) {
      throw new ForbiddenError();
    }

    const [classInfo, schoolInfo] = await Promise.all([
      repo.findClassById(student.classId),
      repo.findSchoolById(student.schoolId),
    ]);

    return { ...student, class: classInfo, school: schoolInfo };
  }

  async createStudent(body: any) {
    validateCreateStudent(body);

    const [classInfo, schoolInfo] = await Promise.all([
      repo.findClassById(body.classId),
      repo.findSchoolById(body.schoolId),
    ]);

    if (!classInfo) throw new NotFoundError('Class not found');
    if (!schoolInfo) throw new NotFoundError('School not found');

    const student = {
      studentId: randomUUID(),
      classId: body.classId,
      schoolId: body.schoolId,
      lastName: body.lastName,
      firstName: body.firstName,
      phone: body.phone ?? null,
      email: body.email ?? null,
      createdAt: new Date().toISOString(),
    };

    return repo.save(student);
  }

  async updateStudent(studentId: string, body: any) {
    validateUpdateStudent(body);

    const student = await repo.findById(studentId);
    if (!student) throw new NotFoundError('Student not found');

    const allowedFields = ['firstName', 'lastName', 'phone', 'email'];
    const updates: Record<string, any> = {};
    allowedFields.forEach(field => {
      if (body[field] !== undefined) updates[field] = body[field];
    });

    return repo.update(studentId, updates);
  }

  async deleteStudent(studentId: string) {
    const student = await repo.findById(studentId);
    if (!student) throw new NotFoundError('Student not found');
    await repo.delete(studentId);
  }
}