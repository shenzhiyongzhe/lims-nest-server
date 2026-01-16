import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailConfigModule } from '../email-config/email-config.module';

@Module({
  imports: [PrismaModule, EmailConfigModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
