import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '@config/env';
import { ApiError } from '@utils/ApiError';
import { auditService } from '@modules/audit/audit.service';
import { authRepository } from './auth.repository';
import { ChangePasswordInput, RegisterInput, LoginInput, UpdateThemeInput } from './auth.schema';

/**
 * Auth Service
 *
 * Contains all business logic. Controllers just pass data here,
 * and this layer decides what to do (e.g., throwing ApiErrors
 * if validation or logic fails).
 */
export class AuthService {
  /**
   * Register a new user
   */
  async register(data: RegisterInput) {
    // 1. Check if email is already taken
    const existingUser = await authRepository.findByEmail(data.email);
    if (existingUser) {
      throw ApiError.conflict('Email is already in use');
    }

    // 2. Hash password (12 rounds is current industry standard)
    const passwordHash = await bcrypt.hash(data.password, 12);

    // 3. Create user via repository
    const user = await authRepository.create({
      name: data.name,
      email: data.email,
      passwordHash,
      role: 'EMPLOYEE',
      rbacRole: { connect: { name: 'EMPLOYEE' } },
    });

    // 4. Exclude passwordHash from returned object
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  /**
   * Authenticate user and return tokens
   */
  async login(data: LoginInput) {
    try {
      // 1. Find user
      const user = await authRepository.findByEmail(data.email);
      if (!user) {
        // Use generic error for security (don't reveal if email exists)
        throw ApiError.unauthorized('Invalid email or password');
      }

      // 2. Check if active
      if (!user.isActive) {
        throw ApiError.forbidden('Account has been deactivated');
      }

      // 3. Verify password
      const isValid = await bcrypt.compare(data.password, user.passwordHash);
      if (!isValid) {
        throw ApiError.unauthorized('Invalid email or password');
      }

      // 4. Generate tokens
      const tokens = this.generateTokens(user);

      // 5. Exclude passwordHash
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { passwordHash: _, ...userWithoutPassword } = user;

      await this.audit({
        module: 'authentication',
        entity: 'Session',
        entityId: user.id,
        action: 'LOGIN',
        userId: user.id,
        success: true,
        metadata: { email: user.email, role: user.role },
      });

      return { user: userWithoutPassword, tokens };
    } catch (error) {
      await this.audit({
        module: 'authentication',
        entity: 'Session',
        action: 'LOGIN_FAILED',
        success: false,
        metadata: { email: data.email },
      });
      throw error;
    }
  }

  async logout(user?: { id: string }) {
    if (!user) return;
    await this.audit({
      module: 'authentication',
      entity: 'Session',
      entityId: user.id,
      action: 'LOGOUT',
      userId: user.id,
    });
  }

  /**
   * Issue new access token using a valid refresh token
   */
  async refreshToken(token: string) {
    try {
      const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as {
        userId: string;
      };

      const user = await authRepository.findById(decoded.userId);

      if (!user || !user.isActive) {
        throw ApiError.unauthorized('Invalid refresh token');
      }

      const tokens = this.generateTokens(user);
      return tokens;
    } catch (error) {
      throw ApiError.unauthorized('Invalid or expired refresh token');
    }
  }

  async changePassword(userId: string, data: ChangePasswordInput) {
    const user = await authRepository.findById(userId);
    if (!user || !user.isActive) {
      throw ApiError.unauthorized('Invalid user');
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      data.currentPassword,
      user.passwordHash
    );
    if (!isCurrentPasswordValid) {
      throw ApiError.unauthorized('Current password is incorrect');
    }

    if (data.currentPassword === data.newPassword) {
      throw ApiError.badRequest('New password must be different from current password');
    }

    const passwordHash = await bcrypt.hash(data.newPassword, 12);
    await authRepository.updatePassword(user.id, passwordHash);
    await this.audit({
      module: 'authentication',
      entity: 'User',
      entityId: user.id,
      action: 'PASSWORD_CHANGED',
      userId: user.id,
    });
  }

  async updateTheme(userId: string, data: UpdateThemeInput) {
    const user = await authRepository.findById(userId);
    if (!user || !user.isActive) {
      throw ApiError.unauthorized('Invalid user');
    }

    const updatedUser = await authRepository.updateTheme(user.id, data.themePreference);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }

  /**
   * Helper: Generate Access and Refresh Tokens
   */
  private generateTokens(user: { id: string; email: string; role: string }) {
    const role = normalizeRole(user.role);
    if (!role) {
      throw ApiError.unauthorized('Invalid user role');
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role,
    };

    const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN as any,
    });

    const refreshToken = jwt.sign({ userId: user.id }, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as any,
    });

    return { accessToken, refreshToken };
  }

  private async audit(input: Parameters<typeof auditService.logBusinessAction>[0]) {
    await auditService.logBusinessAction(input).catch(() => undefined);
  }
}

function normalizeRole(role: string | Role | null | undefined): Role | undefined {
  const normalized = String(role ?? '').trim().toUpperCase();

  if (normalized === Role.ADMIN) return Role.ADMIN;
  if (normalized === Role.EMPLOYEE) return Role.EMPLOYEE;

  return undefined;
}

export const authService = new AuthService();
