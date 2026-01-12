import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Admin, ManagementRoles } from '@prisma/client';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ResponseAdminDto } from './dto/response-admin.dto';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

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
      const created = await tx.admin.create({
        data: { ...data, role: data.role as ManagementRoles },
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
  update(id: number, data: CreateAdminDto): Promise<Admin> {
    return this.prisma.admin.update({
      where: { id },
      data: { ...data, role: data.role as ManagementRoles },
    });
  }
  delete(id: number): Promise<Admin> {
    return this.prisma.admin.delete({ where: { id } });
  }
  findById(id: number): Promise<Admin | null> {
    return this.prisma.admin.findUnique({ where: { id } });
  }
  toResponse(admin: Admin): ResponseAdminDto {
    const { id, username, role, password } = admin;
    return { id, username, role, password: password ?? '' };
  }
}
