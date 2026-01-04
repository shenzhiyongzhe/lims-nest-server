import { Module } from '@nestjs/common';
import { AssetManagementService } from './asset-management.service';
import { AssetManagementController } from './asset-management.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';

@Module({
  imports: [PrismaModule, OperationLogsModule],
  controllers: [AssetManagementController],
  providers: [AssetManagementService],
  exports: [AssetManagementService],
})
export class AssetManagementModule {}
