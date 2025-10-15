import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { User } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { PaginatedResponseDto } from './dto/paginated-response.dto';
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: PaginationQueryDto,
    userId: number,
  ): Promise<PaginatedResponseDto<User>> {
    const { page = 1, pageSize = 20, search } = query;
    const skip = (page - 1) * pageSize;
    const admin = await this.prisma.admin.findUnique({
      where: { id: userId },
      select: { id: true, role: true, username: true },
    });

    if (!admin) {
      throw new Error('管理员不存在');
    }
    const where = {} as any;
    if (search) {
      where.username = {
        contains: search,
      };
    }
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: {
          id: 'desc',
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    return {
      data: users,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }
  login(username: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { username } });
  }
  findById(id: number): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
  create(data: CreateUserDto): Promise<User> {
    return this.prisma.user.create({ data: { ...data, password: '123456' } });
  }

  update(id: number, data: CreateUserDto): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  delete(id: number): Promise<User> {
    return this.prisma.user.delete({ where: { id } });
  }
  toResponse(user: User): User {
    return user;
  }
}
