import { Module } from '@nestjs/common';
import { RandomDecimalService } from './random-decimal.service';
import { RandomDecimalController } from './random-decimal.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RandomDecimalController],
  providers: [RandomDecimalService],
  exports: [RandomDecimalService],
})
export class RandomDecimalModule {}
