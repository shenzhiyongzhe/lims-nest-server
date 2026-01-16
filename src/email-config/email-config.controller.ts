import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Delete,
  Param,
  UseGuards,
} from '@nestjs/common';
import { EmailConfigService } from './email-config.service';
import { CreateEmailConfigDto } from './dto/create-email-config.dto';
import { UpdateEmailConfigDto } from './dto/update-email-config.dto';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { AuthGuard } from '../auth/auth.guard';

@Controller('email-config')
@UseGuards(AuthGuard)
export class EmailConfigController {
  constructor(private readonly emailConfigService: EmailConfigService) {}

  @Get()
  async findAll(): Promise<ApiResponseDto> {
    const configs = await this.emailConfigService.findAll();
    return ResponseHelper.success(configs, '获取邮箱配置成功');
  }

  @Get('statistics')
  async getStatistics(): Promise<ApiResponseDto> {
    const statistics = await this.emailConfigService.getStatistics();
    return ResponseHelper.success(statistics, '获取统计信息成功');
  }

  @Get('statistics/:id')
  async getStatisticsById(@Param('id') id: number): Promise<ApiResponseDto> {
    const statistics = await this.emailConfigService.getStatistics(id);
    return ResponseHelper.success(statistics, '获取统计信息成功');
  }

  @Get(':id')
  async findById(@Param('id') id: number): Promise<ApiResponseDto> {
    const config = await this.emailConfigService.findById(id);
    if (!config) {
      return ResponseHelper.error('邮箱配置不存在');
    }
    return ResponseHelper.success(config, '获取邮箱配置成功');
  }

  @Post()
  async create(@Body() body: CreateEmailConfigDto): Promise<ApiResponseDto> {
    const config = await this.emailConfigService.create(body);
    return ResponseHelper.success(config, '创建邮箱配置成功');
  }

  @Put(':id')
  async update(
    @Param('id') id: number,
    @Body() body: UpdateEmailConfigDto,
  ): Promise<ApiResponseDto> {
    const config = await this.emailConfigService.update(id, body);
    return ResponseHelper.success(config, '更新邮箱配置成功');
  }

  @Delete(':id')
  async delete(@Param('id') id: number): Promise<ApiResponseDto> {
    const config = await this.emailConfigService.delete(id);
    return ResponseHelper.success(config, '删除邮箱配置成功');
  }

  @Post(':id/toggle')
  async toggleEnabled(@Param('id') id: number): Promise<ApiResponseDto> {
    const config = await this.emailConfigService.toggleEnabled(id);
    return ResponseHelper.success(config, '切换状态成功');
  }

  @Post('reset-daily-counts')
  async resetDailyCounts(): Promise<ApiResponseDto> {
    await this.emailConfigService.resetDailyCounts();
    return ResponseHelper.success(null, '重置每日计数成功');
  }
}
