import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Admin, ManagementRoles } from '@prisma/client';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ResponseAdminDto } from './dto/response-admin.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // 加密密码
  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  // 验证密码
  async comparePassword(
    plainPassword: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  login(username: string): Promise<Admin | null> {
    return this.prisma.admin.findFirst({ where: { username } });
  }
  findAll(): Promise<Admin[]> {
    return this.prisma.admin.findMany();
  }
  findByRole(role: ManagementRoles): Promise<Admin[]> {
    return this.prisma.admin.findMany({ where: { role } });
  }

  async create(data: CreateAdminDto): Promise<Admin> {
    return this.prisma.$transaction(async (tx) => {
      // 如果提供了密码，加密密码
      const hashedPassword = data.password
        ? await this.hashPassword(data.password)
        : await this.hashPassword('123456');

      const created = await tx.admin.create({
        data: {
          ...data,
          password: hashedPassword,
          role: data.role as ManagementRoles,
        },
      });

      // 如果创建的是收款人，自动创建对应的 Payee
      if (created.role === 'PAYEE') {
        const paymentLimit = 1000;
        await tx.payee.create({
          data: {
            admin_id: created.id,
            username: created.username,
            address: '广东深圳',
            payment_limit: paymentLimit,
            remaining_limit: paymentLimit, // 初始化剩余额度等于总额度
            qrcode_number: 3,
            is_disabled: false,
          },
        });
      }

      return created;
    });
  }
  async update(id: number, data: CreateAdminDto): Promise<Admin> {
    const updateData: any = { ...data, role: data.role as ManagementRoles };

    // 如果更新了密码，加密新密码
    if (data.password) {
      updateData.password = await this.hashPassword(data.password);
      // 更新token版本，使旧token失效
      updateData.token_version = { increment: 1 };
    }

    return this.prisma.admin.update({
      where: { id },
      data: updateData,
    });
  }

  // 更新登录信息
  async updateLoginInfo(id: number, ipAddress: string): Promise<void> {
    await this.prisma.admin.update({
      where: { id },
      data: {
        last_login_at: new Date(),
        last_login_ip: ipAddress,
        failed_login_attempts: 0, // 登录成功，重置失败次数
      },
    });
  }

  // 增加失败登录次数
  async incrementFailedAttempts(id: number): Promise<void> {
    await this.prisma.admin.update({
      where: { id },
      data: {
        failed_login_attempts: { increment: 1 },
      },
    });
  }
  delete(id: number): Promise<Admin> {
    return this.prisma.admin.delete({ where: { id } });
  }
  findById(id: number): Promise<Admin | null> {
    return this.prisma.admin.findUnique({ where: { id } });
  }

  // 重置密码为默认密码
  async resetPassword(id: number): Promise<Admin> {
    const defaultPassword = '123456';
    const hashedPassword = await this.hashPassword(defaultPassword);
    return this.prisma.admin.update({
      where: { id },
      data: {
        password: hashedPassword,
        token_version: { increment: 1 }, // 更新token版本，使旧token失效
      },
    });
  }

  toResponse(admin: Admin): ResponseAdminDto {
    const { id, username, role, password, email } = admin;
    return {
      id,
      username,
      role,
      password: password ?? '',
      email: email ?? '-',
    };
  }
}
