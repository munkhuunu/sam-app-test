import { BadRequestError } from '../utils/errors';

// ====== Auth ======
export const validateRegister = (body: any) => {
  if (!body.email || !body.password || !body.role)
    throw new BadRequestError('email, password, role required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
    throw new BadRequestError('Invalid email format');
  if (body.password.length < 6)
    throw new BadRequestError('Password must be at least 6 characters');
  const roles = ['DIRECTOR', 'MANAGER', 'TEACHER', 'PARENT', 'STUDENT'];
  if (!roles.includes(body.role))
    throw new BadRequestError('Invalid role');
};

export const validateLogin = (body: any) => {
  if (!body.email || !body.password)
    throw new BadRequestError('email, password required');
};

// ====== School ======
export const validateCreateSchool = (body: any) => {
  if (!body.name) throw new BadRequestError('name required');
  if (body.name.length < 2) throw new BadRequestError('name must be at least 2 characters');
};

// ====== Class ======
export const validateCreateClass = (body: any) => {
  if (!body.name || body.grade === undefined)
    throw new BadRequestError('name, grade required');
  if (typeof body.grade !== 'number' || body.grade < 1 || body.grade > 12)
    throw new BadRequestError('grade must be a number between 1 and 12');
};

// ====== Student ======
export const validateCreateStudent = (body: any) => {
  if (!body.classId || !body.schoolId || !body.firstName || !body.lastName)
    throw new BadRequestError('classId, schoolId, firstName, lastName required');
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
    throw new BadRequestError('Invalid email');
  if (body.phone && !/^[0-9]{8}$/.test(body.phone))
    throw new BadRequestError('Phone must be 8 digits');
};

export const validateUpdateStudent = (body: any) => {
  if (Object.keys(body).length === 0)
    throw new BadRequestError('No fields to update');
};

// ====== Teacher ======
export const validateCreateTeacher = (body: any) => {
  if (!body.schoolId || !body.firstName || !body.lastName)
    throw new BadRequestError('schoolId, firstName, lastName required');
};

export const validateAssignTeacher = (body: any) => {
  if (!body.teacherId || !body.classId)
    throw new BadRequestError('teacherId, classId required');
};

// ====== Subject ======
export const validateCreateSubject = (body: any) => {
  if (!body.name || !body.schoolId)
    throw new BadRequestError('name, schoolId required');
};

// ====== Grade ======
export const validateAddGrade = (body: any) => {
  if (!body.studentId || !body.subjectId || !body.classId || body.score === undefined)
    throw new BadRequestError('studentId, subjectId, classId, score required');
  if (typeof body.score !== 'number' || body.score < 0 || body.score > 100)
    throw new BadRequestError('score must be 0-100');
};

// ====== Attendance ======
export const validateMarkAttendance = (body: any) => {
  if (!body.classId || !body.date || !body.records)
    throw new BadRequestError('classId, date, records required');
  if (!Array.isArray(body.records) || body.records.length === 0)
    throw new BadRequestError('records must be a non-empty array');
  const valid = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
  for (const r of body.records) {
    if (!r.studentId || !r.status)
      throw new BadRequestError('Each record needs studentId, status');
    if (!valid.includes(r.status))
      throw new BadRequestError(`Invalid status: ${r.status}`);
  }
};
