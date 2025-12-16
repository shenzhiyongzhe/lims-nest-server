import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePayeeDto } from './create-payee.dto';
import { PayeeDailyStatisticsService } from '../payee-daily-statistics/payee-daily-statistics.service';
import { Payee, PaymentMethod, QrCode } from '@prisma/client';
import { UploadResponseDto } from './dto/upload-response.dto';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

@Injectable()
export class PayeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payeeDailyStatisticsService: PayeeDailyStatisticsService,
  ) {}

  create(data: CreatePayeeDto): Promise<Payee> {
    const paymentLimit = (data as any).payment_limit ?? 1000;
    const payload = {
      ...data,
      // 默认值：若未传入则使用默认
      address: data.address ?? '广东深圳',
      payment_limit: paymentLimit,
      remaining_limit: paymentLimit, // 初始化剩余额度等于总额度
      qrcode_number: (data as any).qrcode_number ?? 3,
    };
    return this.prisma.payee.create({ data: payload });
  }
  findAll(): Promise<Payee[]> {
    return this.prisma.payee.findMany();
  }
  findById(id: number): Promise<Payee | null> {
    return this.prisma.payee.findUnique({ where: { id } });
  }
  update(id: number, data: CreatePayeeDto): Promise<Payee> {
    return this.prisma.payee.update({
      where: { id: id },
      data,
    });
  }
  delete(id: number): Promise<Payee | null> {
    return this.prisma.payee.delete({ where: { id } });
  }
  toResponse(payee: Payee): Payee {
    return payee;
  }

  async uploadFile(
    file: Express.Multer.File,
    qrcodeType: string,
    userId: number,
  ): Promise<UploadResponseDto> {
    if (!file) {
      throw new BadRequestException('没有文件');
    }

    // 验证文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('不支持的文件类型');
    }

    // 验证文件大小 (5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('文件过大');
    }

    // 创建上传目录
    const uploadDir = join(process.cwd(), 'public/uploads/payee');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // 根据用户ID和二维码类型生成文件名
    const timestamp = Date.now();
    const extension = file.originalname?.split('.').pop() || 'jpg';
    const filename = `${userId}_${qrcodeType}_${timestamp}.${extension}`;
    const filepath = join(uploadDir, filename);

    // 保存文件
    await writeFile(filepath, file.buffer);

    // 返回文件访问路径
    const fileUrl = `/uploads/payee/${filename}`;

    return {
      url: fileUrl,
      filename: filename,
      size: file.size,
      type: file.mimetype,
    };
  }

  private async getPayeeIdByAdmin(adminId: number): Promise<number> {
    const payee = await this.prisma.payee.findFirst({
      where: { admin_id: adminId },
      select: { id: true },
    });
    if (!payee) {
      throw new NotFoundException('收款人不存在');
    }
    return payee.id;
  }

  async findQRCodes(params: {
    payee_id: number;
    payment_method?: PaymentMethod;
    active?: boolean;
  }) {
    return this.prisma.qrCode.findMany({
      where: {
        payee_id: params.payee_id,
        ...(params.payment_method
          ? { qrcode_type: params.payment_method }
          : {}),
        ...(params.active !== undefined ? { active: params.active } : {}),
      },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        qrcode_url: true,
        qrcode_type: true,
        active: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async createQRCode(
    adminId: number,
    data: { qrcode_type: PaymentMethod; qrcode_url: string },
  ) {
    if (!data.qrcode_type || !data.qrcode_url) {
      throw new BadRequestException('缺少必要参数');
    }
    const payeeId = await this.getPayeeIdByAdmin(adminId);
    const created = await this.prisma.qrCode.create({
      data: {
        payee_id: payeeId,
        qrcode_type: data.qrcode_type,
        qrcode_url: data.qrcode_url,
        active: true,
      },
      select: {
        id: true,
        qrcode_url: true,
        qrcode_type: true,
        active: true,
        created_at: true,
        updated_at: true,
      },
    });
    return created;
  }

  async uploadAndCreateQRCode(
    file: Express.Multer.File,
    qrcodeType: string,
    adminId: number,
  ) {
    const uploaded = await this.uploadFile(file, qrcodeType, adminId);
    const created = await this.createQRCode(adminId, {
      qrcode_type: qrcodeType as PaymentMethod,
      qrcode_url: uploaded.url,
    });
    return created;
  }
  updateQRCode(id: number, data: { active: boolean }): Promise<QrCode> {
    return this.prisma.qrCode.update({ where: { id }, data });
  }
  deleteQRCode(id: number): Promise<QrCode | null> {
    return this.prisma.qrCode.delete({ where: { id } });
  }

  async getMyStatistics(adminId: number) {
    const payee = await this.prisma.payee.findFirst({
      where: { admin_id: adminId },
      select: { id: true, payment_limit: true },
    });

    if (!payee) {
      throw new NotFoundException('收款人不存在');
    }

    const statistics =
      await this.payeeDailyStatisticsService.getTodayAndYesterdayStatistics(
        payee.id,
      );
    const remaining_limit = await this.prisma.payee.findUnique({
      where: { id: payee.id },
      select: { remaining_limit: true },
    });

    return {
      daily_balance: remaining_limit?.remaining_limit ?? 0,
      today_amount: statistics.today.daily_total,
      yesterday_amount: statistics.yesterday.daily_total,
      payment_limit: payee.payment_limit,
    };
  }
}
