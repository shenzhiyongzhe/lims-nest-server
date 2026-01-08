import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { OperationLogsService } from './operation-logs.service';
import { GetOperationLogsDto } from './dto/get-operation-logs.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ManagementRoles } from '@prisma/client';
import { ResponseHelper } from 'src/common/response-helper';
import { ApiResponseDto } from 'src/common/dto/api-response.dto';

@Controller('operation-logs')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ManagementRoles.ADMIN) // Only admins can view operation logs
export class OperationLogsController {
  constructor(private readonly operationLogsService: OperationLogsService) {}

  @Get()
  async getOperationLogs(
    @Query() query: GetOperationLogsDto,
  ): Promise<ApiResponseDto> {
    const logs = await this.operationLogsService.getOperationLogs(query);
    return ResponseHelper.success(logs, '操作日志获取成功');
  }

  @Get(':id')
  async getOperationLogById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponseDto> {
    const log = await this.operationLogsService.getOperationLogById(id);
    if (!log) {
      return ResponseHelper.error('操作日志不存在', 404);
    }
    return ResponseHelper.success(log, '操作日志获取成功');
  }
}
