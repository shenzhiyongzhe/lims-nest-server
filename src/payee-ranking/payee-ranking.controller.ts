import { Controller, Get, UseGuards } from '@nestjs/common';
import { PayeeRankingService } from './payee-ranking.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ManagementRoles } from '@prisma/client';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';

@Controller('payee-ranking')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ManagementRoles.管理员, ManagementRoles.收款人)
export class PayeeRankingController {
  constructor(private readonly payeeRankingService: PayeeRankingService) {}

  @Get()
  async getRankings(): Promise<ApiResponseDto> {
    const rankings = await this.payeeRankingService.getRankings();
    return ResponseHelper.success(rankings, '获取排行榜成功');
  }
}
