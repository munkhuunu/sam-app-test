import { BadRequestError } from '../utils/errors';

export const validateRegister = (body: any) => {
  if (!body.email || !body.password) throw new BadRequestError('email, password required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new BadRequestError('Invalid email format');
  if (body.password.length < 6) throw new BadRequestError('Password must be at least 6 characters');
};

export const validateLogin = (body: any) => {
  if (!body.email || !body.password) throw new BadRequestError('email, password required');
};

export const validateCreateSchool = (body: any) => {
  if (!body.name) throw new BadRequestError('name required');
  if (body.name.length < 2) throw new BadRequestError('name must be at least 2 characters');
};

export const validateCreateClass = (body: any) => {
  if (!body.name || body.grade === undefined) throw new BadRequestError('name, grade required');
  if (typeof body.grade !== 'number' || body.grade < 1 || body.grade > 12)
    throw new BadRequestError('grade must be 1-12');
};

export const validateCreateStudent = (body: any) => {
  if (!body.classId || !body.firstName || !body.lastName)
    throw new BadRequestError('classId, firstName, lastName required');
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
    throw new BadRequestError('Invalid email');
};

export const validateCreateTeacher = (body: any) => {
  if (!body.firstName || !body.lastName) throw new BadRequestError('firstName, lastName required');
};

export const validateAssignTeacher = (body: any) => {
  if (!body.teacherId || !body.classId) throw new BadRequestError('teacherId, classId required');
};

export const validateTeacherSubjectAssignment = (body: any) => {
  if (!body.teacherId || !body.classId || !body.subjectId)
    throw new BadRequestError('teacherId, classId, subjectId required');
};

export const validateCreateSubject = (body: any) => {
  if (!body.name) throw new BadRequestError('name required');
};

export const validateCreateInvitation = (body: any) => {
  if (!body.role) throw new BadRequestError('role required');
  const roles = ['DIRECTOR', 'MANAGER', 'TEACHER', 'PARENT', 'STUDENT'];
  if (!roles.includes(body.role)) throw new BadRequestError('Invalid role');
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
    throw new BadRequestError('Invalid email format');
};

export const validateCreateAssignment = (body: any) => {
  if (!body.title || !body.classId || !body.subjectId || !body.type)
    throw new BadRequestError('title, classId, subjectId, type required');
  const types = ['HOMEWORK', 'EXAM', 'QUIZ', 'PROJECT'];
  if (!types.includes(body.type)) throw new BadRequestError('Invalid type: ' + body.type);
  if (body.maxScore !== undefined && (typeof body.maxScore !== 'number' || body.maxScore < 1))
    throw new BadRequestError('maxScore must be a positive number');
};

export const validateGradeAssignment = (body: any) => {
  if (!body.studentId || body.score === undefined)
    throw new BadRequestError('studentId, score required');
  if (typeof body.score !== 'number' || body.score < 0)
    throw new BadRequestError('score must be a non-negative number');
};

export const validateCreateAnnouncement = (body: any) => {
  if (!body.title || !body.content) throw new BadRequestError('title, content required');
  const audiences = ['ALL', 'TEACHER', 'STUDENT', 'PARENT'];
  if (body.audience && !audiences.includes(body.audience))
    throw new BadRequestError('Invalid audience');
};

export const validateLinkParentStudent = (body: any) => {
  if (!body.studentId) throw new BadRequestError('studentId required');
};

export const validateMarkAttendance = (body: any) => {
  if (!body.classId || !body.date || !body.records)
    throw new BadRequestError('classId, date, records required');
  if (!Array.isArray(body.records) || body.records.length === 0)
    throw new BadRequestError('records must be a non-empty array');
  const valid = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
  for (const r of body.records) {
    if (!r.studentId || !r.status) throw new BadRequestError('Each record needs studentId, status');
    if (!valid.includes(r.status)) throw new BadRequestError(`Invalid status: ${r.status}`);
  }
};
