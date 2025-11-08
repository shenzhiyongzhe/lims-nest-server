import { Module } from '@nestjs/common';
import { OperationLogsService } from './operation-logs.service';
import { OperationLogsController } from './operation-logs.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [OperationLogsService],
  controllers: [OperationLogsController],
  exports: [OperationLogsService],
})
export class OperationLogsModule {}
