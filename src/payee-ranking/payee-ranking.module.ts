import { Module } from '@nestjs/common';
import { PayeeRankingService } from './payee-ranking.service';
import { PayeeRankingController } from './payee-ranking.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PayeeRankingController],
  providers: [PayeeRankingService],
  exports: [PayeeRankingService],
})
export class PayeeRankingModule {}
