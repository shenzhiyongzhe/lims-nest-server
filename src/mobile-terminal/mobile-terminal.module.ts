import { Module } from '@nestjs/common';
import { MobileTerminalService } from './mobile-terminal.service';
import { MobileTerminalController } from './mobile-terminal.controller';
import { PayeeDailyStatisticsModule } from '../payee-daily-statistics/payee-daily-statistics.module';
import { RepaymentRecordsModule } from '../repayment-records/repayment-records.module';

@Module({
  imports: [PayeeDailyStatisticsModule, RepaymentRecordsModule],
  controllers: [MobileTerminalController],
  providers: [MobileTerminalService],
  exports: [MobileTerminalService],
})
export class MobileTerminalModule {}
