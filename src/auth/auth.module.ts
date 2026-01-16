import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthJwtService } from './jwt.service';
import { LoginAttemptService } from './login-attempt.service';
import { AuthGuard } from './auth.guard';

@Global()
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
  providers: [AuthJwtService, LoginAttemptService, AuthGuard],
  controllers: [AuthController],
  exports: [AuthJwtService, LoginAttemptService, AuthGuard],
})
export class AuthModule {}
