import { Module } from '@nestjs/common';
import { AdminService } from './admins.service';
import { AdminController } from './admins.controller';
import { VisitorsModule } from '../visitors/visitors.module';

@Module({
  imports: [VisitorsModule],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminsModule {}
