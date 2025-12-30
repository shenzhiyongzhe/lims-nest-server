import { Controller, Get, UseGuards, Res } from '@nestjs/common';
import { BackupService } from './backup.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ManagementRoles } from '@prisma/client';
import type { Response } from 'express';

@Controller('backup')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ManagementRoles.管理员)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get('download')
  async downloadBackup(@Res() res: Response) {
    try {
      const buffer = await this.backupService.createBackupZip();

      // 生成文件名：backup_YYYYMMDD_HHmmss.zip
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const fileName = `backup_${year}${month}${day}_${hours}${minutes}${seconds}.zip`;

      // 设置响应头
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(
          fileName,
        )}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      res.setHeader('Content-Length', buffer.length);

      // 发送文件
      res.send(buffer);
    } catch (error: any) {
      console.error('备份下载失败:', error);
      res.status(500).json({
        code: 500,
        message: `备份下载失败: ${error.message}`,
      });
    }
  }
}
