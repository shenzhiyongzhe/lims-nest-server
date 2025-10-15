import { Module } from '@nestjs/common';
import { LoanAccountRolesController } from './loanAccountRoles.controller';
import { LoanAccountRolesService } from './loanAccountRoles.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LoanAccountRolesController],
  providers: [LoanAccountRolesService],
  exports: [LoanAccountRolesService],
})
export class LoanAccountRolesModule {}
