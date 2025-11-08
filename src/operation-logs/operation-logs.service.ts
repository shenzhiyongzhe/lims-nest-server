import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LogOperationDto } from './dto/log-operation.dto';
import { GetOperationLogsDto } from './dto/get-operation-logs.dto';
import {
  OperationLogResponse,
  PaginatedOperationLogsResponse,
} from './dto/operation-log-response.dto';

@Injectable()
export class OperationLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async logOperation(dto: LogOperationDto): Promise<void> {
    try {
      await this.prisma.operationLog.create({
        data: {
          entity_type: dto.entity_type,
          entity_id: dto.entity_id,
          operation_type: dto.operation_type,
          admin_id: dto.admin_id,
          admin_username: dto.admin_username,
          old_data: dto.old_data,
          new_data: dto.new_data,
          ip_address: dto.ip_address,
        },
      });
      console.log(
        `✅ 操作日志已记录: ${dto.operation_type} ${dto.entity_type} ${dto.entity_id}`,
      );
    } catch (error) {
      console.error('❌ 记录操作日志失败:', error);
      // Don't throw error - logging should not break the main operation
    }
  }

  async getOperationLogs(
    dto: GetOperationLogsDto,
  ): Promise<PaginatedOperationLogsResponse> {
    const {
      entity_type,
      operation_type,
      startDate,
      endDate,
      page = 1,
      pageSize = 20,
      admin_id,
    } = dto;

    const where: any = {};

    if (entity_type) {
      where.entity_type = entity_type;
    }

    if (operation_type) {
      where.operation_type = operation_type;
    }

    if (admin_id) {
      where.admin_id = admin_id;
    }

    if (startDate || endDate) {
      where.created_at = {};
      if (startDate) {
        where.created_at.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.created_at.lte = end;
      }
    }

    const [logs, total] = await Promise.all([
      this.prisma.operationLog.findMany({
        where,
        orderBy: {
          created_at: 'desc',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.operationLog.count({ where }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    const data: OperationLogResponse[] = logs.map((log) => ({
      id: log.id,
      entity_type: log.entity_type,
      entity_id: log.entity_id,
      operation_type: log.operation_type,
      admin_id: log.admin_id,
      admin_username: log.admin_username,
      old_data: log.old_data,
      new_data: log.new_data,
      ip_address: log.ip_address,
      created_at: log.created_at,
    }));

    return {
      data,
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

  async getOperationLogById(id: number): Promise<OperationLogResponse | null> {
    const log = await this.prisma.operationLog.findUnique({
      where: { id },
    });

    if (!log) {
      return null;
    }

    return {
      id: log.id,
      entity_type: log.entity_type,
      entity_id: log.entity_id,
      operation_type: log.operation_type,
      admin_id: log.admin_id,
      admin_username: log.admin_username,
      old_data: log.old_data,
      new_data: log.new_data,
      ip_address: log.ip_address,
      created_at: log.created_at,
    };
  }
}
