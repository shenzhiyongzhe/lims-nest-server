import { Module } from '@nestjs/common';
import { RepaymentSchedulesController } from './repayment-schedules.controller';
import { RepaymentSchedulesService } from './repayment-schedules.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RepaymentSchedulesController],
  providers: [RepaymentSchedulesService],
  exports: [RepaymentSchedulesService],
})
export class RepaymentSchedulesModule {}
