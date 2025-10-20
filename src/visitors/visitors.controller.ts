import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { VisitorsService } from './visitors.service';
import { LogVisitDto } from './dto/log-visit.dto';
import { GetVisitorStatsDto } from './dto/get-visitor-stats.dto';
import { GetTopVisitorsDto } from './dto/get-top-visitors.dto';
import { AuthGuard } from '../auth/auth.guard';
import { ResponseHelper } from '../common/response-helper';

@Controller('visitors')
export class VisitorsController {
  constructor(private readonly visitorsService: VisitorsService) {}

  @Post('log')
  async logVisit(@Body() logVisitDto: LogVisitDto) {
    await this.visitorsService.logVisit(logVisitDto);
    return ResponseHelper.success(null, 'Visitor activity logged successfully');
  }

  @Get('stats')
  @UseGuards(AuthGuard)
  async getVisitorStats(@Query() query: GetVisitorStatsDto) {
    const stats = await this.visitorsService.getVisitorStats(query);
    return ResponseHelper.success(
      stats,
      'Visitor statistics retrieved successfully',
    );
  }

  @Get('top')
  @UseGuards(AuthGuard)
  async getTopVisitors(@Query() query: GetTopVisitorsDto) {
    const topVisitors = await this.visitorsService.getTopVisitors(query);
    return ResponseHelper.success(
      topVisitors,
      'Top visitors retrieved successfully',
    );
  }

  @Post('calculate')
  @UseGuards(AuthGuard)
  async calculateDailyStats(@Body() body: { date: string }) {
    const { date } = body;
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    await this.visitorsService.calculateDailyStats(targetDate);
    return ResponseHelper.success(
      `Daily visitor stats calculated for ${date}`,
      'Visitor statistics calculation completed',
    );
  }

  @Post('calculate-range')
  @UseGuards(AuthGuard)
  async calculateStatsRange(
    @Body() body: { startDate: string; endDate: string },
  ) {
    const { startDate, endDate } = body;
    const start = new Date(startDate);
    const end = new Date(endDate);

    await this.visitorsService.calculateMissingStats(start, end);
    return ResponseHelper.success(
      `Visitor stats calculated from ${startDate} to ${endDate}`,
      'Visitor statistics calculation completed',
    );
  }
}
