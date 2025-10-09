import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePayeeDto } from './create-payee.dto';
import { Payee } from '@prisma/client';
import { UploadResponseDto } from './dto/upload-response.dto';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

@Injectable()
export class PayeesService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreatePayeeDto): Promise<Payee> {
    return this.prisma.payee.create({ data });
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
    file: any,
    qrcodeType: string,
    userId: number,
  ): Promise<UploadResponseDto> {
    if (!file) {
      throw new BadRequestException('没有文件');
    }

    // 验证文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype as string)) {
      throw new BadRequestException('不支持的文件类型');
    }

    // 验证文件大小 (5MB)
    const maxSize = 5 * 1024 * 1024;
    if ((file.size as number) > maxSize) {
      throw new BadRequestException('文件过大');
    }

    // 创建上传目录
    const uploadDir = join(process.cwd(), 'public/uploads/payee');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // 根据用户ID和二维码类型生成文件名
    const timestamp = Date.now();
    const extension = (file.originalname as string)?.split('.').pop() || 'jpg';
    const filename = `${userId}_${qrcodeType}_${timestamp}.${extension}`;
    const filepath = join(uploadDir, filename);

    // 保存文件
    await writeFile(filepath, file.buffer as Buffer);

    // 返回文件访问路径
    const fileUrl = `/uploads/payee/${filename}`;

    return {
      url: fileUrl,
      filename: filename,
      size: file.size as number,
      type: file.mimetype as string,
    };
  }
}
