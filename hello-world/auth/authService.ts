import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { AuthRepository } from './authRepository';
import { validateRegister, validateLogin } from '../validators/authValidator';
import { ConflictError, UnauthorizedError } from '../utils/errors';

const repo = new AuthRepository();

export class AuthService {

  async register(body: any) {
    validateRegister(body);

    const existing = await repo.findByEmail(body.email);
    if (existing) throw new ConflictError('Email already exists');

    const hashedPassword = await bcrypt.hash(body.password, 10);

    const user = {
      userId: randomUUID(),
      email: body.email,
      password: hashedPassword,
      role: body.role,
      schoolId: body.schoolId ?? null,
      classId: body.classId ?? null,
      studentId: body.studentId ?? null,
      createdAt: new Date().toISOString(),
    };

    await repo.save(user);

    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async login(body: any) {
    validateLogin(body);

    const user = await repo.findByEmail(body.email);
    if (!user) throw new UnauthorizedError('Invalid email or password');

    const isValid = await bcrypt.compare(body.password, user.password);
    if (!isValid) throw new UnauthorizedError('Invalid email or password');

    const token = jwt.sign(
      {
        userId: user.userId,
        email: user.email,
        role: user.role,
        schoolId: user.schoolId,
        classId: user.classId,
        studentId: user.studentId,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '8h' }
    );

    return {
      token,
      user: {
        userId: user.userId,
        email: user.email,
        role: user.role,
      },
    };
  }
}