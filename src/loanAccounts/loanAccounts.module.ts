import { Module } from '@nestjs/common';
import { LoanAccountsService } from './loanAccounts.service';
import { LoanAccountsController } from './loanAccounts.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { ExcelExportService } from '../common/excel-export.service';
import { LoanPredictionModule } from '../loan-prediction/loan-prediction.module';

@Module({
  imports: [PrismaModule, OperationLogsModule, LoanPredictionModule],
  providers: [LoanAccountsService, ExcelExportService],
  controllers: [LoanAccountsController],
  exports: [LoanAccountsService],
})
export class LoanAccountsModule {}
