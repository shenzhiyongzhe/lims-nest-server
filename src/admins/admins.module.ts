import { Module } from '@nestjs/common';
import { AdminService } from './admins.service';
import { AdminController } from './admins.controller';

@Module({
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminsModule {}
