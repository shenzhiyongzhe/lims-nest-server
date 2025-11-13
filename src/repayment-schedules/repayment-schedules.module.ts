import { Module } from '@nestjs/common';
import { RepaymentSchedulesController } from './repayment-schedules.controller';
import { RepaymentSchedulesService } from './repayment-schedules.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';

import { LoanAccountsModule } from '../loanAccounts/loanAccounts.module';

@Module({
  imports: [PrismaModule, OperationLogsModule, LoanAccountsModule],
  controllers: [RepaymentSchedulesController],
  providers: [RepaymentSchedulesService],
  exports: [RepaymentSchedulesService],
})
export class RepaymentSchedulesModule {}
