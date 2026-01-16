import { Module } from '@nestjs/common';
import { AdminService } from './admins.service';
import { AdminController } from './admins.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { LoginAttemptService } from '../auth/login-attempt.service';
import { AuthJwtService } from '../auth/jwt.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret:
          configService.get<string>('JWT_SECRET') ||
          'your-secret-key-change-in-production',
        signOptions: {
          expiresIn: '15m',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AdminService, LoginAttemptService, AuthJwtService],
  controllers: [AdminController],
  exports: [AdminService],
})
export class AdminsModule {}
