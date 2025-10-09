import { Module } from '@nestjs/common';
import { PayeesController } from './payees.controller';
import { PayeesService } from './payees.service';
import { PrismaModule } from '../../prisma/prisma.module';
@Module({
  imports: [PrismaModule],
  controllers: [PayeesController],
  providers: [PayeesService],
  exports: [PayeesService],
})
export class PayeesModule {}
