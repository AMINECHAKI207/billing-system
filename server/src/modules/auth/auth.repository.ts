import { prisma } from '@config/database';
import { User, Prisma } from '@prisma/client';

/**
 * Auth / User Repository
 *
 * This layer is strictly for interacting with the database.
 * No business logic (like password hashing or token generation)
 * should live here.
 *
 * WHY? If we ever move away from Prisma, we only rewrite this file.
 */
export class AuthRepository {
  /**
   * Find a user by their email address
   */
  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  /**
   * Find a user by ID
   */
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  /**
   * Create a new user
   */
  async create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({
      data,
    });
  }

  async updatePassword(id: string, passwordHash: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async updateTheme(id: string, themePreference: 'light' | 'dark'): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { themePreference },
    });
  }
}

export const authRepository = new AuthRepository();
