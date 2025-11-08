import { Module } from '@nestjs/common';
import { RepaymentSchedulesController } from './repayment-schedules.controller';
import { RepaymentSchedulesService } from './repayment-schedules.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LoanAccountsService } from '../loanAccounts/loanAccounts.service';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';

@Module({
  imports: [PrismaModule, OperationLogsModule],
  controllers: [RepaymentSchedulesController],
  providers: [RepaymentSchedulesService, LoanAccountsService],
  exports: [RepaymentSchedulesService],
})
export class RepaymentSchedulesModule {}
