import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { RandomDecimalService } from './random-decimal.service';
import { AuthGuard } from '../auth/auth.guard';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';

@Controller('random-decimal')
@UseGuards(AuthGuard)
export class RandomDecimalController {
  constructor(private readonly randomDecimalService: RandomDecimalService) {}

  /**
   * 获取指定 loan_id 和 period 的当天随机小数
   * GET /random-decimal/:loanId/:period
   */
  @Get(':loanId/:period')
  async getDailyRandomDecimal(
    @Param('loanId') loanId: string,
    @Param('period') period: string,
  ): Promise<ApiResponseDto> {
    try {
      const periodNum = parseInt(period, 10);
      if (isNaN(periodNum) || periodNum < 1) {
        return ResponseHelper.error('期数必须是大于0的整数', 400);
      }

      const decimal = await this.randomDecimalService.getDailyRandomDecimal(
        loanId,
        periodNum,
      );

      return ResponseHelper.success(
        {
          decimal, // 1-99
          decimalValue: decimal / 100, // 0.01-0.99
        },
        '获取随机小数成功',
      );
    } catch (error: any) {
      return ResponseHelper.error(`获取随机小数失败: ${error.message}`, 500);
    }
  }
}
