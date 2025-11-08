import { Module } from '@nestjs/common';
import { AdminService } from './admins.service';
import { AdminController } from './admins.controller';

@Module({
  imports: [],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminsModule {}
