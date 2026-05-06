import { AuthUser } from './auth';

export const enforceSchoolTenant = (user: AuthUser, schoolId: string): void => {
  if (user.role === 'SUPER_ADMIN') return;
  if (!user.schoolId || user.schoolId !== schoolId) {
    throw { statusCode: 403, message: 'Cross-tenant access denied' };
  }
};
