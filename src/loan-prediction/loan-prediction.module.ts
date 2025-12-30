import { Module } from '@nestjs/common';
import { LoanPredictionService } from './loan-prediction.service';
import { LoanPredictionController } from './loan-prediction.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LoanPredictionController],
  providers: [LoanPredictionService],
  exports: [LoanPredictionService],
})
export class LoanPredictionModule {}
