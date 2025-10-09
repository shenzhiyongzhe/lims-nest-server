import { Module } from '@nestjs/common';
import { LoanAccountsService } from './loanAccounts.service';
import { LoanAccountsController } from './loanAccounts.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [LoanAccountsService],
  controllers: [LoanAccountsController],
  exports: [LoanAccountsService],
})
export class LoanAccountsModule {}
