import { Module } from '@nestjs/common';
import { EmailConfigService } from './email-config.service';
import { EmailConfigController } from './email-config.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EmailConfigController],
  providers: [EmailConfigService],
  exports: [EmailConfigService],
})
export class EmailConfigModule {}
