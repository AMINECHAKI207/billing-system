import bcrypt from 'bcryptjs';
import { Prisma, Role } from '@prisma/client';
import { ApiError } from '@utils/ApiError';
import { parsePagination } from '@utils/pagination';
import { CreateUserInput, UpdateUserInput, UserQueryInput } from './user.schema';
import { userRepository } from './user.repository';

export class UserService {
  async getUsers(query: UserQueryInput) {
    const { skip, limit, page } = parsePagination({ page: query.page, limit: query.limit });
    const where: Prisma.UserWhereInput = {
      ...(query.role && { role: query.role }),
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };
    const { data, total } = await userRepository.findAll({ skip, take: limit, where });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async createUser(data: CreateUserInput) {
    const existingUser = await userRepository.findByEmail(data.email);
    if (existingUser) {
      throw ApiError.conflict('Email is already in use');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    return userRepository.create({
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash,
      role: data.role,
      rbacRole: { connect: { name: data.role } },
      isActive: data.isActive ?? true,
    });
  }

  async updateUser(id: string, currentUserId: string, data: UpdateUserInput) {
    const user = await userRepository.findRawById(id);
    if (!user) {
      throw ApiError.notFound('User');
    }

    if (data.email && data.email !== user.email) {
      const existingUser = await userRepository.findByEmail(data.email);
      if (existingUser && existingUser.id !== id) {
        throw ApiError.conflict('Email is already in use');
      }
    }

    if (id === currentUserId) {
      if (data.isActive === false) {
        throw ApiError.badRequest('You cannot deactivate your own account');
      }
      if (data.role && data.role !== Role.ADMIN) {
        throw ApiError.badRequest('You cannot remove your own admin role');
      }
    }

    const updateData: Prisma.UserUpdateInput = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.email !== undefined && { email: data.email.toLowerCase() }),
      ...(data.role !== undefined && { role: data.role }),
      ...(data.role !== undefined && { rbacRole: { connect: { name: data.role } } }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.password !== undefined && {
        passwordHash: await bcrypt.hash(data.password, 12),
      }),
    };

    return userRepository.update(id, updateData);
  }
}

export const userService = new UserService();
