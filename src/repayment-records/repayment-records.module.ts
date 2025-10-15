import { Module } from '@nestjs/common';
import { RepaymentRecordsController } from './repayment-records.controller';
import { RepaymentRecordsService } from './repayment-records.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RepaymentRecordsController],
  providers: [RepaymentRecordsService],
  exports: [RepaymentRecordsService],
})
export class RepaymentRecordsModule {}
